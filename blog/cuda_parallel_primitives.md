# CUDA 并行原语与性能分析

这里沿用[CUDA 编程模型](post.html?slug=cuda_programming)中的 Grid、Block、Warp 和 Shared Memory，并在[CUDA 执行与内存模型](post.html?slug=cuda_execution_model)的同步与访存机制上构造 Reduction、Scan、Histogram 和 Softmax。每种模式都要同时检查正确性边界和硬件资源成本。

# 1. Reduction

Reduction 把：

```text
x0 x1 x2 ... xn
```

通过结合运算压缩成一个结果：

```text
sum
max
min
product
...
```

串行求和：

```cpp
float sum = 0.0f;

for (int i = 0; i < n; ++i)
    sum += input[i];
```

形成：

```text
sum0
 ↓
sum1
 ↓
sum2
 ↓
sum3
```

是一条长度为：

```text
O(n)
```

的依赖链。

并行 Reduction 则构造树：

```text
x0 x1 x2 x3 x4 x5 x6 x7
 \ /   \ /   \ /   \ /
  +     +     +     +
   \   /       \   /
     +           +
       \       /
           +
```

并行深度：

```text
O(log n)
```

总工作量仍然是：

```text
O(n)
```

---

## 1.1 Block-Level Reduction

教学版 CUDA Kernel：

```cpp
__global__ void reduce_sum_blocks(
    const float* input,
    float* block_sums,
    std::size_t size) {

    extern __shared__ float scratch[];

    const unsigned int tid =
        threadIdx.x;

    const std::size_t first =
        static_cast<std::size_t>(
            blockIdx.x)
        * blockDim.x
        * 2
        + tid;

    float value = 0.0f;

    if (first < size)
        value += input[first];

    if (first + blockDim.x < size)
        value +=
            input[first + blockDim.x];

    scratch[tid] = value;

    __syncthreads();

    // 教学版本：
    // 假设 blockDim.x 是 2 的幂。
    for (unsigned int stride =
             blockDim.x / 2;
         stride > 0;
         stride >>= 1) {

        if (tid < stride) {
            scratch[tid] +=
                scratch[tid + stride];
        }

        __syncthreads();
    }

    if (tid == 0) {
        block_sums[blockIdx.x] =
            scratch[0];
    }
}
```

整个过程：

```text
Global Memory
      ↓
每 Thread 读取数据
      ↓
Register Partial Sum
      ↓
Shared Memory
      ↓
Tree Reduction
      ↓
Thread 0
      ↓
Block Partial Sum
```

然后：

```text
Block Partial Sums
```

还需要再次 Reduction。

---

## 1.2 Warp Reduction

Shared Memory Reduction 后半段只剩下一个 Warp 时，可以利用：

```text
Warp Shuffle
```

直接在 Lane 的寄存器之间传递数据。

逻辑上：

```text
Lane:

0 1 2 3 4 5 6 7

Step 1:
0 += 4
1 += 5
2 += 6
3 += 7

Step 2:
0 += 2
1 += 3

Step 3:
0 += 1
```

这样可以降低：

```text
Shared Memory Traffic
+
Block Barrier 数量
```

生产级 Reduction 往往进一步考虑：

- Warp Shuffle；
- Vectorized Load；
- 一个 Thread 加载多个元素；
- Grid-Stride Loop；
- 更合理的 Block 数量；
- Mixed Precision；
- Deterministic Reduction；
- Cooperative Groups；
- CUB 等成熟库实现。

---

## 1.3 浮点 Reduction 的数值问题

浮点加法不满足严格结合律。

例如：

```text
(a + b) + c
```

可能和：

```text
a + (b + c)
```

得到略有不同的结果。

因此：

```text
Serial Reduction
```

和：

```text
Tree Reduction
```

甚至两个不同的并行 Reduction Tree，都可能产生不同的低位 bit。

所以测试 GPU Reduction 时不能简单认为：

```text
bitwise unequal
=
implementation wrong
```

应该根据算法要求设置合理误差范围。

如果要求确定性，则必须专门约束 Reduction 顺序或使用对应 deterministic strategy。

---

# 2. Prefix Scan

Scan 输出每个位置之前或之前加当前位置的聚合结果。

例如：

```text
Input:

[a, b, c, d]
```

Exclusive Scan：

```text
[e, a, a+b, a+b+c]
```

其中：

```text
e
```

是运算的单位元。

Inclusive Scan：

```text
[a, a+b, a+b+c, a+b+c+d]
```

Scan 是大量并行算法的基础：

```text
Stream Compaction
Radix Sort
Parallel Allocation
Prefix Index
Sparse Data Structure Construction
```

---

## 2.1 Blelloch Scan

经典 Blelloch Scan 分为两个阶段。

### Upsweep

```text
a b c d e f g h
 \ /   \ /   \ /
  +     +     +
   \   /       \   /
      ... Reduction Tree
```

建立部分和。

---

### Downsweep

把根设置成单位元，然后向下传播 Prefix：

```text
          identity
          /      \
       prefix   prefix
       /  \      /  \
      ...        ...
```

可以实现：

```text
Work = O(n)
Depth = O(log n)
```

---

## 2.2 大规模 Scan

如果数组超过一个 Block：

```text
Input
 │
 ├── Block 0 Scan
 ├── Block 1 Scan
 ├── Block 2 Scan
 └── Block 3 Scan
```

每个 Block 得到：

```text
Local Scan
+
Block Total
```

然后：

```text
Scan(Block Totals)
```

得到每个 Block 的 Prefix Offset。

最后：

```text
Local Scan
+
Block Offset
```

得到全局 Scan。

因此很多 GPU 算法会自然形成：

```text
Local Phase
    ↓
Global Metadata Phase
    ↓
Fix-up Phase
```

这种分层并行结构。

---

# 3. Histogram

最朴素的 Histogram：

```cpp
atomicAdd(
    &histogram[input[i]],
    1);
```

问题在于如果输入分布集中：

```text
Thread 0 ─┐
Thread 1 ─┤
Thread 2 ─┤
Thread 3 ─┼──→ histogram[7]
Thread 4 ─┤
Thread 5 ─┘
```

大量线程争用同一个 Atomic 地址。

于是：

```text
Parallel Threads
```

最终可能在热点位置：

```text
严重序列化
```

---

## 3.1 Privatization

经典优化：

```text
Global Histogram
        ▲
        │ Merge
        │
Block-local Histogram
        ▲
        │
Shared Memory Atomic
        ▲
        │
Input
```

例如每个 Block：

```text
Block 0 → local histogram 0
Block 1 → local histogram 1
Block 2 → local histogram 2
```

最后再合并：

```text
local0
local1
local2
   │
   ▼
global histogram
```

它把：

```text
Global Atomic Contention
```

转换成：

```text
更多局部 Atomic
+
最后一次 Merge
```

---

## 3.2 Histogram 的核心 Trade-off

Privatization 并不是免费：

```text
更多 Shared Memory
+
初始化成本
+
Merge 成本
```

而且当桶数量很大时：

```text
Bins × sizeof(counter)
```

可能无法放入一个 Block 的 Shared Memory。

因此策略取决于：

```text
Bin Count
Input Distribution
Shared Memory Capacity
Contention
```

而不能认为：

```text
“用了 Shared Memory 就一定快”
```

---

# 4. Softmax

稳定 Softmax：

```text
m = max(x)

s = Σ exp(x_i - m)

y_i = exp(x_i - m) / s
```

如果直接从数学表达式看，好像只是：

```text
max
exp
sum
division
```

但从 CUDA 角度看，它实际上组合了多个并行原语：

```text
Load
 ↓
Max Reduction
 ↓
exp
 ↓
Sum Reduction
 ↓
Normalize
 ↓
Store
```

因此 Softmax 是理解 GPU Kernel Fusion 的非常好的案例。

---

## 4.1 朴素实现的问题

如果每个阶段单独一个 Kernel：

```text
Kernel 1:
max(x)

Kernel 2:
exp(x - max)

Kernel 3:
sum(exp)

Kernel 4:
normalize
```

意味着中间结果反复：

```text
Register
   ↓
Global Memory
   ↓
再次 Load
```

产生大量：

```text
Global Memory Round Trip
+
Kernel Launch
```

---

## 4.2 Fused Softmax

更好的设计：

```text
Load Row
   ↓
Register / Shared
   ↓
Max Reduction
   ↓
exp
   ↓
Sum Reduction
   ↓
Normalize
   ↓
Store Once
```

当行比较短时：

```text
1 Warp
   ↓
1 Row
```

可能非常合适。

行更长时可以采用：

```text
Multiple Warps
   ↓
1 Row
```

并通过 Shared Memory 协作。

---

## 4.3 Online Softmax

还可以把局部状态表示成：

```text
(max, sum)
```

假设两个分片：

```text
State 1:
(m1, s1)

State 2:
(m2, s2)
```

合并时：

```text
m = max(m1, m2)

s =
    s1 * exp(m1 - m)
  + s2 * exp(m2 - m)
```

这样 `(max, sum)` 就可以作为一个可组合状态进行 Reduction。

这个技巧非常重要，因为它把：

```text
先完整求 Max
再完整求 Sum
```

转换成更加适合：

```text
Streaming
Tiling
Fusion
```

的形式。

这也是很多高性能 Attention / Softmax 算法的重要数学基础。

---

# 5. Occupancy

Occupancy 通常表示：

```text
当前实际可驻留的活跃 Warp 数
---------------------------
硬件理论允许的最大活跃 Warp 数
```

它描述：

```text
SM 上有多少 Warp 可以参与调度
```

更多 Warp 的重要价值之一是隐藏延迟。

例如：

```text
Warp 0

Load Global Memory
       ↓
    waiting
```

Warp Scheduler 可以切换到：

```text
Warp 1 → Compute
Warp 2 → Compute
Warp 3 → Address Calculation
```

于是：

```text
Memory Latency
```

可以被其他 Warp 的工作覆盖。

---

## 5.1 Occupancy 受什么限制

一个 Kernel 的 Resident Block / Warp 数通常受：

```text
Threads / Block

Registers / Thread

Shared Memory / Block

Maximum Resident Blocks

Maximum Resident Warps
```

共同限制。

粗略写成：

```text
resident_blocks
<= min(

    thread_budget
      / threads_per_block,

    register_budget
      / registers_per_block,

    shared_memory_budget
      / shared_memory_per_block,

    architectural_block_limit
)
```

真实硬件还需要考虑：

```text
Register Allocation Granularity
Shared Memory Allocation Granularity
Warp Limits
Architecture-specific Rules
```

所以这个式子只是理解模型，而不是精确计算器。

---

# 6. Occupancy 不是最终目标

假设方案 A：

```text
Small Tile
Low Register Usage
Low Shared Memory

Occupancy = High
```

方案 B：

```text
Large Tile
More Registers
More Shared Memory
More Reuse

Occupancy = Lower
```

最终方案 B 完全可能更快。

原因是：

```text
更多数据复用
↓
更少 Global Memory Traffic
```

可能比：

```text
Occupancy 从 60% → 100%
```

重要得多。

类似地，为了提高 Occupancy 强制降低寄存器：

```text
Register Limit
      ↓
Register Spill
      ↓
Local Memory Traffic
      ↓
Performance Worse
```

也是常见反例。

因此正确的问题不是：

```text
“怎样达到 100% Occupancy？”
```

而是：

```text
“当前 Resident Warps
是否已经足够隐藏主要延迟？”
```

---

# 7. Roofline：先判断是算力瓶颈还是带宽瓶颈

CUDA 性能优化前最好先问：

```text
Kernel 是：

Compute Bound

还是：

Memory Bound
```

一个非常重要的概念叫：

```text
Arithmetic Intensity
```

即：

```text
FLOPs
-----
Bytes
```

如果每搬运大量数据只做一点计算：

```text
Low Arithmetic Intensity
```

通常更容易：

```text
Memory Bound
```

例如：

```text
Vector Add
```

主要工作：

```text
Load A
Load B
Store C
```

计算只有一个加法。

而矩阵乘法经过良好 Tiling 后：

```text
同一份 A / B Tile
被重复使用很多次
```

Arithmetic Intensity 很高，更容易接近 Compute Bound。

所以 Shared Memory Tiling 的本质之一就是：

```text
增加 Data Reuse
      ↓
提高 Arithmetic Intensity
```

---

# 8. CUDA Kernel 性能分析的统一方法

遇到一个慢 Kernel，可以按下面顺序分析。

---

## 8.1 第一问：并行度够不够

看：

```text
Grid Size
Blocks
Warps
Resident Warps
```

如果只有：

```text
几个 Block
```

即使单个 Block 优化得很好，也可能根本无法利用整个 GPU。

---

## 8.2 第二问：Memory Traffic 合理吗

看：

```text
Global Load / Store

Coalescing

Cache Behavior

Shared Memory Reuse

Spill
```

如果理论只需要读取：

```text
1 GB
```

实际却产生：

```text
5 GB
```

的 DRAM Traffic，那么应该先优化数据搬运。

---

## 8.3 第三问：Warp 为什么不能持续 Issue

常见原因：

```text
Memory Dependency

Barrier

Instruction Dependency

Insufficient Eligible Warps

Pipeline Saturation
```

性能分析的核心问题可以压缩成：

> 当前阻止 Warp 继续执行的主要原因是什么？

---

## 8.4 第四问：算力单元有没有被有效使用

如果已经不是 Memory Bound：

```text
FP Pipeline
Tensor Core
Integer Pipeline
```

是否得到充分利用？

此时才应该重点考虑：

```text
Instruction Selection
FMA
MMA
Unroll
Software Pipeline
```

---

# 9. 一个 CUDA 性能心智模型

最终可以把 CUDA 性能问题总结成：

```text
         ┌─────────────────┐
         │   Parallelism   │
         └────────┬────────┘
                  │
                  ▼
┌──────────┐  ┌───────────┐  ┌───────────┐
│ Memory   │  │   Warp    │  │ Resource  │
│ Traffic  │  │ Efficiency│  │ Pressure  │
└──────────┘  └───────────┘  └───────────┘
      │             │              │
      ▼             ▼              ▼
 Coalescing     Divergence      Registers
 Reuse          Barrier         Shared Mem
 Cache          Idle Lane       Occupancy
 Spill
```

所以不要孤立优化：

```text
Occupancy
```

或者：

```text
Instruction Count
```

真正目标始终是：

```text
提高最终吞吐 / 降低实际延迟
```

---

# 10. 选读：CUDA Tile Programming Model

经典 CUDA C++ 使用的是：

```text
SIMT Programming Model
```

程序员写：

```text
Thread-level Program
```

并显式决定：

```text
threadIdx
blockDim
每个 Thread 处理什么
```

当前 CUDA 还开始提供另一种更高层的：

```text
Tile Programming Model
```

其思想更接近：

```text
程序员描述一个 Block 级 Tile 操作
              ↓
Compiler
              ↓
把 Tile 操作分布到实际 Threads
```

也就是说：

```text
SIMT：

Programmer
    ↓
Thread Program
    ↓
Warp / Hardware
```

而 Tile Programming 更像：

```text
Programmer
    ↓
Block / Tile Program
    ↓
Compiler
    ↓
Thread Mapping
    ↓
Hardware
```

这和 AI Compiler 中：

```text
Tensor Tile
   ↓
Compiler Mapping
   ↓
GPU Threads
```

的思想非常接近。

不过对于理解传统 CUDA、GPU Runtime 和绝大多数现有 CUDA Kernel，仍然应该首先掌握：

```text
Grid
 ↓
Block
 ↓
Warp
 ↓
Thread
```

这一经典 SIMT 模型。

---
