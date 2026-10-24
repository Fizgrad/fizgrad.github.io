# 张量计算、融合与性能算法

本文从张量的地址计算出发，依次讨论 GEMM、融合、CPU 缓存与 SIMD、成本模型及验证。

# 1. 张量 Shape、Stride 与 Layout

## 1.1 多维下标如何变成地址

一个 rank 为 R 的张量可用：

```text
shape   = [d0, d1, ..., d(R-1)]
stride  = [s0, s1, ..., s(R-1)]
offset  = base + sum(index[i] * stride[i])
```

若 stride 以元素为单位，最后还要乘元素字节数；若 stride 已按字节定义，就不能重复乘。

行主序连续二维矩阵 `[M, N]`：

```text
stride = [N, 1]
offset(i, j) = i * N + j
```

转置 view 可以只交换 shape 和 stride，不立即搬移数据：

```text
shape  = [N, M]
stride = [1, N]
```

## 1.2 安全计算线性偏移

```cpp
#include <limits>
#include <optional>
#include <vector>

std::optional<std::size_t> linear_offset(
    const std::vector<std::size_t>& shape,
    const std::vector<std::size_t>& stride,
    const std::vector<std::size_t>& index) {
    if (shape.size() != stride.size() || shape.size() != index.size()) {
        return std::nullopt;
    }

    std::size_t offset = 0;
    for (std::size_t axis = 0; axis < shape.size(); ++axis) {
        if (index[axis] >= shape[axis]) return std::nullopt;
        if (index[axis] != 0 &&
            stride[axis] > std::numeric_limits<std::size_t>::max() / index[axis]) {
            return std::nullopt;
        }
        const std::size_t term = index[axis] * stride[axis];
        if (offset > std::numeric_limits<std::size_t>::max() - term) {
            return std::nullopt;
        }
        offset += term;
    }
    return offset;
}
```

函数返回相对于 storage 起点的元素偏移，实际地址还要结合 base pointer 和元素字节数。这里没有处理负 stride；某些 runtime 支持反向 view，需要有符号偏移并验证最终地址范围。

## 1.3 Contiguous 不是唯一 Layout

Shape 描述逻辑上有多少元素、各轴有多长；layout 描述这些元素如何存放，或如何分配到线程与寄存器。两个张量都叫 `[M, N]`，下标对应的物理地址却可能不同。真实布局中的这些名称分别解决不同问题，也可以组合使用。

**Padding** 是在物理存储中预留额外槽位。例如逻辑矩阵每行有 3 个元素，却为每行分配 4 个元素的空间：

```text
逻辑 shape = [2, 3]，物理 stride = [4, 1]

存储：[a00 a01 a02 pad] [a10 a11 a12 pad]
地址：offset(i, j) = i * 4 + j
```

它可以让行起点满足对齐要求，也可以把长度补到向量宽度或 tile 大小的整数倍。代价是额外空间；kernel 若仍按 `i * 3 + j` 寻址，就会读错第二行。Padding 槽位不属于逻辑元素，也不一定已初始化，不能直接参与计算；需要屏蔽尾部，或按算子语义填入合适的中性值，例如求和用 0、最大值归约用负无穷。这里的存储 padding 与卷积在逻辑输入边界补零不是同一个概念。

**Blocked / Tiled Layout** 把矩阵按小块连续存放，而不是把完整的一行连续存放。例如一个 `[4, 4]` 矩阵按 `[2, 2]` 分块，并按块行顺序、块内行主序存储：

```text
普通行主序：a00 a01 a02 a03 | a10 a11 a12 a13 | ...
分块存储：  a00 a01 a10 a11 | a02 a03 a12 a13 | ...

offset(i, j) = ((i / 2) * 2 + j / 2) * 4
             + (i % 2) * 2 + j % 2
```

这里 `/` 是非负整数除法。小块中的数据相邻，适合缓存复用、向量加载或矩阵指令，但原来二维下标的固定 stride 公式不足以表达这个地址映射，需要拆成块坐标与块内坐标。尺寸不能整除块大小时，还要处理 padding 或尾块。它与“循环先按 tile 遍历”需要区分：循环分块可以沿用原来的行主序存储，blocked layout 则改变元素的实际位置。[oneDNN 的 blocked format](https://uxlfoundation.github.io/oneDNN/dev_guide_understanding_memory_formats.html) 就会把通道轴拆成外层块与块内通道。

**Channels-last** 让同一个空间位置的不同通道连续存放。四维图像张量中，N 是批次，C 是通道数，H/W 是高/宽。以逻辑 shape `[N, C, H, W] = [1, 2, 2, 3]` 为例：

```text
NCHW 连续布局：stride = [12, 6, 3, 1]
              同一个通道内，相邻 W 元素连续

Channels-last：stride = [12, 1, 6, 2]
              同一个 (n, h, w) 下，相邻 C 元素连续
```

这有利于沿通道向量化，以及使用某些卷积和矩阵计算 kernel，但跨格式算子可能需要转换布局。在 [PyTorch 的 channels-last 表示](https://docs.pytorch.org/tutorials/intermediate/memory_format_tutorial.html)中，逻辑轴顺序仍可保持 NCHW，只通过 stride 表达物理上类似 NHWC 的存储。不能只看 `shape` 或轴名称判断连续访问方向，也不能假设所有算子都会因此更快。

**Vector Lane Packing** 把多个标量组织成一次向量操作的分量。例如 CPU 上把 `a[i]` 到 `a[i + 3]` 放入一个四分量 SIMD 向量，可以一次完成四个加法。GPU 中也可能让一个线程通过向量加载取得多个相邻元素。对齐满足指令要求、数据连续且尾部处理正确时，可以减少加载或计算指令；否则可能需要拆成标量操作，或增加 gather、重排和掩码。它可以只是寄存器表示或加载策略，也可以配合分块存储，不能一概视为新的内存格式。这里的向量 lane 是一条向量指令的数据分量，与 warp 中代表不同线程的 lane 需要区分。

**Swizzle** 用一个确定的重排规则，把逻辑位置映射到不同物理位置。例如在 `[4, 4]` 小块内使用 `physical_col = logical_col ^ row`，其中 `^` 是按位异或：

```text
逻辑列： 0 1 2 3
第 0 行映射到物理列：0 1 2 3
第 1 行映射到物理列：1 0 3 2
第 2 行映射到物理列：2 3 0 1
第 3 行映射到物理列：3 2 1 0
```

每一行的映射都是置换，不会丢失元素。GPU 常通过类似的地址位重排分散 shared-memory bank 访问，或满足矩阵指令的读取模式。代价是额外的地址计算，以及读写两端都必须使用匹配的映射；一端按普通行主序访问会读错数据。这个小例子只说明重排机制，实际 swizzle 要结合 tile 大小、指令和目标硬件选择，不能随意套用一个异或公式就认为性能一定更好。

**GPU Shared-memory Bank-aware Layout** 是按 shared memory 的硬件 bank 组织选择布局。Bank 可以理解成能够提供并行访问的存储分区；同一 warp 在一次事务中访问同一个 bank 的不同字，可能需要分多轮完成，形成 bank conflict。在常见的 32 个 bank、连续 32-bit 字依次映射到不同 bank 的模型下，假设数组起点映射到 bank 0，若 lane `r` 读取矩阵的第 `r` 行、第 0 列：

```text
tile[32][32]：bank(r, 0) = (r * 32) % 32 = 0
             所有 lane 访问同一 bank 的不同地址

tile[32][33]：bank(r, 0) = (r * 33) % 32 = r
             不同 lane 分散到不同 bank
```

多加一列 padding 就能改变这个访问模式的 bank 映射；swizzle 是另一种办法。因此 bank-aware layout 是设计目标，padding 和 swizzle 是实现手段。效果取决于元素宽度、实际内存事务和访问模式，不能只看数组声明；同址读取的广播也不能简单算作上述冲突。Shared-memory bank conflict 与 global-memory coalescing 是不同问题，优化前者不自动保证后者。相关规则和 padding 示例见 [CUDA Best Practices Guide](https://docs.nvidia.com/cuda/cuda-c-best-practices-guide/index.html#shared-memory-and-memory-banks)。

**CSR / CSC / BSR** 是稀疏矩阵的存储格式。CSR（Compressed Sparse Row，压缩稀疏行）按行保存非零值，并用行偏移和列下标定位：

```text
矩阵：                  CSR（下标从 0 开始）：
0 5 0 0                 row_ptr = [0, 1, 3, 4]
2 0 0 7                 col_idx = [1, 0, 3, 2]
0 0 4 0                 values  = [5, 2, 7, 4]
```

第 1 行使用 `values[row_ptr[1] : row_ptr[2]]`，得到值 2、7，对应列 0、3。CSC（Compressed Sparse Column，压缩稀疏列）把同样的组织方式改成按列保存；BSR（Block Sparse Row，块稀疏行）则按非空小块保存，块内部通常使用稠密存储，因而也可能存有零。它们减少零值存储和部分无效运算，但会增加索引开销、间接访问与负载不均；BSR 还要权衡块内填零。Kernel 必须理解索引数组和块大小，不能沿用稠密矩阵的 `base + i * stride_i + j * stride_j` 直接寻址；稀疏程度不高时，稀疏格式也可能更慢。格式定义见 [cuSPARSE Storage Formats](https://docs.nvidia.com/cuda/cusparse/storage-formats.html)。

**Quantized Packed INT4 / INT8** 同时涉及数值表示与存储打包。INT4 用 4 bit 表示一个量化整数，常把两个值装进一个字节。例如约定第一个值占低 4 bit，则 `[3, 7]` 打包成 `0x73`；访问第 `i` 个值，需要读取第 `i / 2` 个字节，再取对应的高半字节或低半字节。有符号 INT4 还必须按约定解释符号。INT8 的一个值通常已经占一个字节，也可以把多个字节组成适合向量或点积指令的打包单元，不能把 INT8 理解为“一个字节存多个 8-bit 值”。这里的 INT4 指 4-bit 整数，不是 CUDA 中包含四个 32-bit `int` 分量的 `int4` 类型。

量化值还要结合 scale，有些方案还包含 zero point，例如反量化 `x ≈ scale * (q - zero_point)`。参数可能按整个张量、通道或小组保存，具体规则必须与 kernel 匹配。压缩可以减少带宽与存储，但要付出解包、转换和参数读取的成本；量化本身还可能引入数值误差，单纯打包则不改变已有整数值。INT4 的元素也不能直接用“元素数 × 整数字节数”寻址，需要处理位偏移。具体量化约定可参考 [TensorRT Quantization Schemes](https://docs.nvidia.com/deeplearning/tensorrt/latest/inference-library/quantized-types-schemes.html)。

因此，“shape 相同”不代表可直接复用同一 kernel。例如 `[3, 3]` 行主序矩阵的 stride 是 `[3, 1]`，其转置 view 的 shape 仍为 `[3, 3]`，stride 却是 `[1, 3]`；假设行主序的 kernel 会把转置矩阵的 `(0, 1)` 读成原矩阵的 `(0, 1)`，而正确结果应来自原矩阵的 `(1, 0)`。通用的 stride-aware kernel 可以接受两者，只是性能可能不同；针对连续、blocked、稀疏或量化格式生成的专用 kernel，则需要匹配相应的布局与参数。选择实现或缓存编译结果时，应区分实际使用到的 stride、对齐、分块或打包规则和量化方案等条件。

“转置”也不一定需要物理 copy。对于支持 stride view 的稠密张量，转置可以只交换 shape 和 stride，继续共享原来的存储：

```text
原张量 A：shape = [2, 3]，stride = [3, 1]
逻辑内容：[[0, 1, 2], [3, 4, 5]]

转置 view T：shape = [3, 2]，stride = [1, 3]
逻辑内容：[[0, 3], [1, 4], [2, 5]]
A 和 T 共享存储：[0, 1, 2, 3, 4, 5]

若把 T 转为行主序连续存储：stride = [2, 1]
新存储：[0, 3, 1, 4, 2, 5]
```

前一种转置只改元数据，后一种才搬移元素。若消费者支持转置 stride，或允许在加载时调整下标，就可以直接使用 view；若接口要求特定连续格式、矩阵指令要求特定 packing，或反复跨步访问的成本更高，就可能值得做 copy 或 repack。创建 view 的成本小，不代表后续计算也一定快；共享存储还意味着修改 view 会影响原张量。这个结论不能直接推广到所有稀疏或特殊格式，具体 API 是否共享存储需要查看契约，例如 [PyTorch transpose](https://docs.pytorch.org/docs/stable/generated/torch.transpose.html) 对 strided 与 sparse 张量就有不同约定。

## 1.4 Broadcasting

广播轴可看作 stride 为 0：多个逻辑下标读取同一个物理元素。优化时要注意：

- 读广播通常安全；
- 写入 stride-0 view 可能让多个逻辑元素 alias；
- 并行写会产生 data race；
- inplace 变换必须证明别名和覆盖顺序合法。

## 1.5 Shape Inference

Shape inference 可能是：

- 静态整数传播；
- 符号表达式；
- 区间或整除约束；
- 运行时 guard；
- 无法证明时保留 dynamic dimension。

以矩阵乘法为例：

```text
A: [M, K]
B: [K, N]
C: [M, N]
```

若两个 K 是动态值，编译器只能证明符号相等、插入 runtime check，或生成通用 fallback。不能因测试输入相等就静态假设永远相等。

## 1.6 Affine Indexing

仿射表达式形如：

```text
c0 + c1*i1 + c2*i2 + ...
```

Loop interchange、tiling、fusion、dependence analysis 常利用仿射结构。出现数据相关下标 `A[B[i]]` 后，经典 affine 分析通常必须保守处理。

---

# 2. GEMM、Tiling 与 Roofline

## 2.1 GEMM 基础

```text
C[M,N] += A[M,K] * B[K,N]
```

浮点运算量通常约为：

```text
2 * M * N * K FLOPs
```

因为每个输出元素执行 K 次乘加，若把 multiply 和 add 各计一次就是 `2K`。

## 2.2 循环顺序影响局部性

行主序下，一个常见顺序：

```cpp
for (std::size_t i = 0; i < m; ++i) {
    for (std::size_t k = 0; k < k_size; ++k) {
        const float a = A[i * lda + k];
        for (std::size_t j = 0; j < n; ++j) {
            C[i * ldc + j] += a * B[k * ldb + j];
        }
    }
}
```

内层 j 连续访问 B 的一行和 C 的一行，比 `i-j-k` 中沿 k 跨行访问 B 更容易利用缓存和向量化。但最优顺序取决于 layout、尺寸和硬件。

## 2.3 Blocked GEMM

```cpp
#include <algorithm>
#include <cstddef>
#include <stdexcept>

void blocked_gemm_accumulate(const float* a,
                             const float* b,
                             float* c,
                             std::size_t m,
                             std::size_t n,
                             std::size_t k_size,
                             std::size_t lda,
                             std::size_t ldb,
                             std::size_t ldc,
                             std::size_t block_m,
                             std::size_t block_n,
                             std::size_t block_k) {
    const bool has_a = m != 0 && k_size != 0;
    const bool has_b = k_size != 0 && n != 0;
    const bool has_c = m != 0 && n != 0;
    if ((has_a && (a == nullptr || lda < k_size)) ||
        (has_b && (b == nullptr || ldb < n)) ||
        (has_c && (c == nullptr || ldc < n)) ||
        block_m == 0 || block_n == 0 || block_k == 0) {
        throw std::invalid_argument("invalid GEMM arguments");
    }

    for (std::size_t ii = 0; ii < m;) {
        const std::size_t i_end = ii + std::min(block_m, m - ii);
        for (std::size_t kk = 0; kk < k_size;) {
            const std::size_t k_end = kk + std::min(block_k, k_size - kk);
            for (std::size_t jj = 0; jj < n;) {
                const std::size_t j_end = jj + std::min(block_n, n - jj);
                for (std::size_t i = ii; i < i_end; ++i) {
                    for (std::size_t k = kk; k < k_end; ++k) {
                        const float a_value = a[i * lda + k];
                        for (std::size_t j = jj; j < j_end; ++j) {
                            c[i * ldc + j] += a_value * b[k * ldb + j];
                        }
                    }
                }
                jj = j_end;
            }
            kk = k_end;
        }
        ii = i_end;
    }
}
```

接口语义是累加到 C，调用者必须事先初始化 C，并保证三块存储的实际长度及地址乘加都可表示。生产接口可以接收显式 buffer 长度或安全 view，避免只凭裸指针和 leading dimension 推断边界。示例没有实现：

- micro-kernel 和 register tiling；
- SIMD intrinsics；
- packed panel；
- prefetch；
- 多线程与 NUMA；
- mixed precision 和数值补偿。

## 2.4 为什么 Tiling 有效

朴素循环会反复把 A、B、C 数据从低层内存搬入 cache。Tiling 让一个小块在更快层级中被重复使用，从而提高数据复用。

Tile 尺寸需要同时满足：

- 工作集能放入目标 cache/shared memory；
- 向量宽度和 Tensor Core tile 对齐；
- 寄存器使用不能过高；
- 边界 tile 正确处理；
- 线程块数量足以占满设备；
- padding 不引入过多无效计算。

## 2.5 Arithmetic Intensity

算术强度：

```text
Arithmetic Intensity = FLOPs / Bytes transferred
```

Roofline 的简化性能上界：

```text
Attainable Performance
= min(Peak Compute, Memory Bandwidth * Arithmetic Intensity)
```

- 低算术强度通常受带宽限制；
- 高算术强度可能受计算峰值限制；
- Tiling 通过复用减少慢速内存流量，提高有效算术强度；
- 实际性能还受指令吞吐、延迟、occupancy、同步和 launch overhead 影响。

## 2.6 合法性与收益

Loop interchange、fusion 和 tiling 先要满足 dependence legality。浮点 reduction 的重排还可能改变舍入结果：

- 严格 IEEE 语义下，不能随意重结合；
- `fast-math` 或显式允许近似时才有更大空间；
- 即使合法，tile 太小或太大也可能更慢。

---

---

# 3. Fusion、内存规划与 Buffer Reuse

## 3.1 为什么做算子融合

假设：

```text
T = relu(A + B)
Y = T * C
```

分开执行通常要把中间张量 T 写入显存，再读回来。融合后可能让 T 留在寄存器或 shared memory 中，减少：

- kernel launch；
- 全局内存读写；
- 中间 buffer 容量；
- producer/consumer 之间的同步。

## 3.2 Fusion 不是越多越好

过度融合可能导致：

- kernel 代码体积膨胀；
- 寄存器压力上升、occupancy 降低；
- shared memory 超限；
- producer 被不同 consumer 重复计算；
- 并行维度受限；
- 编译时间和 autotuning 空间爆炸；
- 动态 shape 需要大量版本化；
- 原本可调用高优化 library kernel 的算子被拆成较差自定义 kernel。

因此 fusion 同时是 legality 与 profitability 问题。

## 3.3 Fusion Legality

至少检查：

- 数据依赖方向是否被保持；
- 是否跨越有副作用操作；
- memory alias 是否安全；
- reduction 的并行和同步边界；
- layout 是否兼容；
- inplace 写是否覆盖后续仍需读取的值；
- device/stream/collective 边界；
- 浮点重排是否被语义允许。

## 3.4 张量生命周期

对按执行顺序线性化的算子图，可以估计每个中间 buffer：

```text
start = producer 完成位置
end   = 最后一个 consumer 完成位置之后
size  = shape * element_size（考虑 padding/alignment）
```

生命周期不重叠且布局、对齐、memory space 兼容的 buffer 可以复用同一存储。

这与 Linear Scan 寄存器分配非常相似：

- tensor 对应 virtual register；
- memory block 对应 physical register；
- tensor lifetime 对应 live interval；
- 容量不同使问题变成 variable-size allocation；
- dynamic shape 使 size 可能只能运行时确定。

## 3.5 Greedy Memory Planning

一种简单策略：

1. 按 buffer start 排序；
2. 释放所有 end 不晚于当前 start 的 block；
3. 从 free list 中找满足大小与对齐的最小 block；
4. 找不到就扩展 arena；
5. 必要时拆分或合并 free block。

目标可能是：

- 最小化 peak memory；
- 最小化碎片；
- 减少动态分配次数；
- 保持地址稳定；
- 避免不同 stream 的异步生命周期冲突。

这些目标并不总是一致。

## 3.6 In-place 与 Alias

`relu(x)` 看起来可以原地覆盖 x，但必须证明：

- x 没有其他尚未执行的 consumer；
- x 不是只读常量；
- 输出 shape/layout 与输入存储兼容；
- view alias 不会观察到意外修改；
- 自动微分反向过程不需要原始 x；
- 异步 kernel 已经完成对旧值的读取。

引用计数为 1 只是一个线索，不是完整的 alias 和时序证明。

## 3.7 静态与动态内存规划

- 完全静态 shape：编译期可给每个 buffer 固定 offset；
- 有上界的动态 shape：按上界预留，简单但可能浪费；
- 无界动态 shape：运行时 allocator 或分段计划；
- 多 stream：释放时间取决于 event，而非仅取决于 host 调用顺序；
- 跨设备：host、pinned、device、shared memory 属于不同 memory space。

---

# 4. CPU 缓存、SIMD 与数据布局

## 4.1 Big O 之外的成本

对相同的 `O(n)` 扫描，主要差异可能来自：

- cache miss；
- TLB miss；
- 分支预测失败；
- 指令级并行；
- SIMD lane 利用率；
- 内存带宽；
- NUMA remote access；
- 同步与 false sharing。

优化顺序应是：先测量瓶颈，再判断是算法、数据布局、指令还是并行问题。

## 4.2 AoS 与 SoA

```cpp
struct ParticleAoS {
    float x, y, z;
    float velocity_x, velocity_y, velocity_z;
};

struct ParticlesSoA {
    std::vector<float> x, y, z;
    std::vector<float> velocity_x, velocity_y, velocity_z;
};
```

如果 kernel 只更新所有 x，SoA 让相关数据连续，减少无用字段加载并利于 SIMD。如果每次总是处理同一粒子的全部字段，AoS 可能更自然。

AoSoA 按 SIMD 宽度分块，可以兼顾对象分组与向量化。

## 4.3 Cache Blocking

矩阵 tiling 是 cache blocking 的典型案例。类似思想也用于：

- 图分块；
- stencil；
- 图像卷积；
- 数据库 join；
- 编译器稠密 BitSet 批处理。

目标是让工作集在被驱逐前尽可能多次复用，而不是简单“循环层数越多越快”。

## 4.4 SIMD 的前提

自动向量化需要编译器证明：

- 循环迭代间无不安全依赖；
- 内存访问模式可向量化；
- alias 不阻止重排；
- trip count 和 remainder 可处理；
- 操作存在目标向量指令；
- 浮点语义允许所需重排。

C 中的 `restrict` 或 C++ 的别名分析信息可以帮助，但错误承诺无别名会导致未定义行为。

## 4.5 Alignment

对齐可能影响：

- 某些向量 load/store 是否需要额外处理；
- cache line 跨越次数；
- 原子操作支持；
- ABI 与对象布局。

不能为了对齐直接把任意指针向下取整后解引用；必须保证分配范围、对象生命周期和类型别名规则均合法。

## 4.6 False Sharing

不同线程写不同变量，如果变量落在同一 cache line，缓存一致性仍会让该行来回迁移。

缓解方式：

- 每线程私有累加，最后归约；
- 对热点写字段做 cache-line padding；
- 分块让线程处理不重叠区域；
- 降低共享写频率。

Padding 会增加内存占用和 cache footprint，只应对测量确认的热点使用。

## 4.7 NUMA

多 socket 系统中，访问本地 NUMA node 内存通常比远端更低延迟、更高带宽。需要考虑：

- first-touch placement；
- 线程绑核；
- 数据分片与线程归属；
- 跨 node work stealing；
- 内存带宽是否集中在一个 node。

只增加线程数可能让性能下降，因为瓶颈从计算变成远端访存或带宽竞争。

## 4.8 分支与 Branchless

Branchless 写法不是天然更快：

- 可预测分支成本很低；
- branchless 可能执行两条路径的无用工作；
- `cmov`、mask 或 predication 仍占用执行资源；
- GPU 上减少 divergence 的收益模式又不同。

应结合数据分布、目标机器和 profile 判断。

---

# 5. 搜索、Cost Model 与自动调优

## 5.1 为什么需要 Cost Model

同一个合法变换可能有很多参数：

```text
tile_m, tile_n, tile_k
vector_width
unroll_factor
threads_per_block
warps_per_block
pipeline_stages
layout / swizzle
fusion boundary
```

搜索空间是这些选择的笛卡尔积，很快组合爆炸。编译器需要：

- 静态规则过滤非法组合；
- 分析模型估计成本；
- profile 或硬件测量校准；
- autotuner 搜索剩余空间；
- cache 编译结果与测量结果。

## 5.2 Matrix Chain DP

矩阵连乘的结合顺序会改变运算量：

```text
A: p0 x p1
B: p1 x p2
C: p2 x p3
```

`(AB)C` 与 `A(BC)` 数学结果相同，但代价可能差很多。经典 DP：

```text
dp[i][j] = min over i <= k < j:
    dp[i][k] + dp[k+1][j] + p[i] * p[k+1] * p[j+1]
```

```cpp
#include <algorithm>
#include <limits>
#include <optional>
#include <vector>

std::optional<unsigned long long>
matrix_chain_cost(const std::vector<unsigned long long>& dimensions) {
    if (dimensions.size() < 2) return 0;
    const std::size_t matrix_count = dimensions.size() - 1;
    for (const auto dimension : dimensions) {
        if (dimension == 0) return std::nullopt;
    }

    using Cost = unsigned long long;
    const Cost infinity = std::numeric_limits<Cost>::max();
    std::vector<std::vector<Cost>> dp(
        matrix_count, std::vector<Cost>(matrix_count, 0));

    auto checked_multiply = [](Cost a, Cost b) -> std::optional<Cost> {
        if (a != 0 && b > std::numeric_limits<Cost>::max() / a) {
            return std::nullopt;
        }
        return a * b;
    };

    for (std::size_t length = 2; length <= matrix_count; ++length) {
        for (std::size_t first = 0; first + length <= matrix_count; ++first) {
            const std::size_t last = first + length - 1;
            dp[first][last] = infinity;
            for (std::size_t split = first; split < last; ++split) {
                auto product = checked_multiply(dimensions[first],
                                                dimensions[split + 1]);
                if (!product) continue;
                product = checked_multiply(*product, dimensions[last + 1]);
                if (!product || dp[first][split] == infinity ||
                    dp[split + 1][last] == infinity) {
                    continue;
                }
                if (dp[first][split] > infinity - dp[split + 1][last]) continue;
                const Cost partial = dp[first][split] + dp[split + 1][last];
                if (partial > infinity - *product) continue;
                dp[first][last] = std::min(dp[first][last], partial + *product);
            }
        }
    }

    if (dp[0][matrix_count - 1] == infinity) return std::nullopt;
    return dp[0][matrix_count - 1];
}
```

状态数是 `O(n^2)`，枚举区间长度、起点和分割点，因此时间复杂度是 `O(n^3)`，空间复杂度是 `O(n^2)`。若要恢复具体结合顺序，还需记录每个区间的最优 split。

真实 AI Compiler 不能只看 FLOPs：中间张量大小、layout conversion、并行度、library kernel、fusion 和数值语义都会改变最优顺序。

## 5.3 搜索策略

| 策略 | 优点 | 风险 |
|---|---|---|
| 穷举 | 简单、可找全局最好 | 组合爆炸 |
| Grid / Random Search | 易并行 | 可能浪费样本 |
| 贪心 | 编译快 | 容易局部最优 |
| Beam Search | 保留多个候选 | beam width 决定成本和质量 |
| 动态规划 | 子问题结构明确时精确 | 状态可能爆炸 |
| Bayesian Optimization | 少量昂贵测量时有效 | 高维离散约束较难 |
| Learned Cost Model | 推理快、可泛化 | 分布漂移和训练数据偏差 |

## 5.4 剪枝

静态剪枝示例：

- tile 超过 shared memory；
- 每 block 线程数超过硬件上限；
- vector width 不满足对齐或整除条件；
- 估计寄存器数导致 occupancy 太低；
- layout 与指令 shape 不兼容；
- reduction 需要的同步无法在当前层级表达。

剪枝规则必须保守：错误删除合法优质配置会永久限制搜索上限。

## 5.5 Cost Model 的误差

静态模型通常无法完整预测：

- cache 和 TLB 行为；
- 编译器后端生成的具体指令；
- 寄存器 spill；
- GPU occupancy 与 latency hiding；
- 动态 shape 分布；
- 其他进程或 kernel 干扰；
- thermal 和 frequency variation。

因此高质量系统通常结合静态分析与真实测量，并记录模型预测误差。

## 5.6 Rewrite 与 E-graph

局部 peephole rewrite 按固定顺序应用容易遇到 phase ordering：先做 A 可能错过 B，先做 B 又可能错过 A。

E-graph / equality saturation 的思路：

- 同时保存多个等价表达式；
- 反复应用等价规则直到饱和或达到预算；
- 用 cost model 从等价类中抽取最优表达式。

风险：

- e-graph 尺寸爆炸；
- 浮点、溢出、poison 语义下很多代数恒等式并不合法；
- extraction cost 需要反映目标硬件和共享子表达式；
- 必须设置节点数、时间和迭代预算。

---

# 6. 正确性验证与性能实验

## 6.1 先验证 Legality

每个优化 Pass 都应明确：

- 前置条件；
- 保持的语义；
- 修改哪些 IR；
- 保留或失效哪些 analyses；
- 遇到无法证明的情况如何保守退出。

“在测试样例上结果相同”不是语义证明。

## 6.2 常见语义陷阱

### Integer

- 有符号溢出；
- `nsw` / `nuw`；
- shift amount 范围；
- 除零和 `INT_MIN / -1`；
- trunc、extend 与位宽。

### Floating Point

- NaN、Infinity、signed zero；
- rounding mode；
- reassociation；
- contraction / FMA；
- fast-math flags。

### Memory

- alias；
- volatile；
- atomic ordering；
- data race；
- object lifetime；
- alignment；
- trap 与 observable side effect。

### Control Flow

- unreachable；
- exception edge；
- deoptimization / guard；
- PHI incoming edge；
- musttail、convergent、barrier 等特殊约束。

## 6.3 测试层次

- Unit test：单个算法和边界；
- IR regression：输入 IR 与期望 pattern；
- Verifier：每次关键变换后检查 IR 不变量；
- Differential test：优化前后在多组输入比较；
- Fuzzing：生成随机合法程序或图；
- Metamorphic test：利用已知等价变换构造关系；
- End-to-end：编译并运行真实 workload；
- Performance regression：固定硬件和统计口径跟踪。

LLVM 场景还应熟练最小复现、`FileCheck`、`llvm-lit`、`opt -verify-each` 和 pass pipeline 二分。详细工具背景可回到[LLVM 笔记的调试部分](post.html?slug=llvm_review#15-调试-llvm-pass)。

## 6.4 差分测试的边界

随机输入比较优化前后结果很有用，但要避免：

- 输入程序本身含 UB；
- 浮点结果要求错误的 bitwise equality；
- nondeterministic 并发程序；
- 只覆盖很小值域，错过溢出；
- reference implementation 与被测实现共享同一 bug。

## 6.5 Benchmark 方法

至少记录：

- 硬件、频率策略、驱动、编译器与 flags；
- 输入 shape、dtype、layout 和分布；
- warm-up 次数；
- 测量次数和 P50/P90/P99 或置信区间；
- 是否包含数据传输、分配、编译和 launch；
- CPU 绑核、NUMA、后台负载；
- GPU 同步位置；
- 正确性误差阈值。

只报告最快一次容易把噪声当成优化收益。

## 6.6 GPU 计时陷阱

Kernel launch 通常异步。Host 侧调用返回不代表 kernel 完成：

- 使用 GPU event 测设备时间；
- 或在明确位置同步；
- 不要把首次 JIT、cache warm-up 与稳定执行混在一起；
- 多 stream 时要明确 event 依赖；
- 端到端延迟和单 kernel 延迟都应按目标分别报告。

## 6.7 性能归因

发现变快或变慢后继续回答：

- 指令数变化？
- cache miss 或带宽变化？
- register spill？
- occupancy？
- launch 数量？
- fusion 是否减少中间内存流量？
- vector lane 利用率？
- 负载是否从 compute-bound 变为 memory-bound？

没有归因的 benchmark 很难指导下一次优化。
