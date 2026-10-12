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

真实布局可能包含：

- padding；
- blocked / tiled layout；
- channels-last；
- vector lane packing；
- swizzle；
- GPU shared-memory bank-aware layout；
- 稀疏格式 CSR/CSC/BSR；
- quantized packed int4/int8。

因此“shape 相同”不代表可直接复用同一 kernel，“转置”也不一定需要物理 copy。

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
