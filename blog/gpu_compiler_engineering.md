# GPU Compiler：动态形状、成本模型与工程验证

前面的[GPU Kernel 编译与 Lowering](post.html?slug=gpu_kernel_lowering)讨论了 Tiling、并行映射、Memory Promotion 和流水化；这里继续处理动态 Shape、资源限制、版本选择、正确性验证和性能归因。

# 1. Dynamic Shape

如果：

```text
M / N / K
```

运行时才知道，则会影响：

```text
Grid Size

Tile Legality

Vector Width

Alignment

Shared Memory Size

Tensor Core Shape

Tail Strategy

Pipeline Depth
```

因此 AI Compiler 通常不会只有一个 Kernel。

而可能生成：

```text
Variant A
M,N,K nicely aligned

Variant B
common dynamic shape

Variant C
generic fallback
```

运行时：

```text
Shape
  ↓
Guard
  ↓
Select Variant
```

这就是：

```text
Kernel Versioning
```

---

# 2. Runtime Guard

例如：

```text
if K % 16 == 0
and pointers aligned
```

走：

```text
Fast Tensor Core Kernel
```

否则：

```text
Generic Kernel
```

概念上：

```text
Runtime

        ┌───────────────┐
        │ Fast Condition│
        └───────┬───────┘
                │
          ┌─────┴─────┐
          ▼           ▼

      Fast Path    Fallback
```

这比试图构造一个：

```text
“任何 Shape 都最优”
```

的 Kernel 更现实。

---

# 3. Barrier、Atomic 与 Convergent Operation 的编译约束

CPU Compiler 很喜欢做：

```text
Code Motion
Speculation
Duplication
Loop Transformation
```

但 GPU 中某些操作不能随意移动。

例如：

```text
Barrier
Warp Shuffle
Vote
Collective
```

它们依赖：

```text
哪些线程参与
+
这些线程处于哪个动态执行实例
```

例如：

```text
if (cond)
    barrier();
```

编译器不能简单：

```text
hoist
```

成：

```text
barrier();

if (cond)
    ...
```

因为参与线程集合发生了改变。

同样也不能随意把：

```text
一个 Collective
```

复制两份，因为不同 Thread 可能进入不同动态实例。

因此 GPU Compiler 需要保留类似：

```text
Convergent Semantics
```

的信息，限制某些普通 SSA / CFG 优化。

---

# 4. Resource Model

候选 Kernel 在比较性能之前，首先必须：

```text
Legal
```

然后：

```text
Resource Feasible
```

主要资源：

```text
Threads / Block

Registers / Thread

Shared Memory / Block

Warps / Block

Hardware Block Limit

Architecture-specific Resources
```

例如：

```text
Tile = 256 × 256
```

理论数据复用可能非常好。

但是：

```text
Shared Memory = 200 KiB / Block
```

如果目标设备无法支持：

```text
Candidate 直接非法
```

根本没有 benchmark 的必要。

---

# 5. Register Pressure

Compiler 做：

```text
Loop Unroll
Large Thread Tile
Prefetch
Multiple Pipeline Stages
```

都会增加：

```text
Live Values
```

于是：

```text
Register Pressure
```

上升。

例如：

```text
更多 Accumulators
+
A Fragment
+
B Fragment
+
Future Tile State
```

全部同时 Live。

当压力过高：

```text
Registers / Thread ↑
      ↓
Occupancy ↓
```

甚至：

```text
Spill
      ↓
Local Memory
      ↓
Extra Memory Traffic
```

因此 Loop Unroll 不是越大越好。

---

# 6. Shared Memory Pressure

类似地：

```text
Larger Tile
+
More Pipeline Stages
```

提高：

```text
Shared Memory / Block
```

导致：

```text
Resident Blocks / SM
```

下降。

所以：

```text
Data Reuse
```

和：

```text
Parallel Residency
```

之间必须平衡。

---

# 7. 先判断可行，再比较收益

因此 Autotuner 更合理的工作流是：

```text
Generate Candidate

        ↓

Legality Check

        ↓

Resource Feasibility

        ↓

Static Cost Model

        ↓

Compile

        ↓

Benchmark

        ↓

Choose Best Variant
```

而不是：

```text
生成 10000 个配置
↓
全部编译
↓
全部运行
```

静态阶段可以提前删除：

```text
Too Many Threads

Too Much Shared Memory

Unsupported MMA Shape

Invalid Alignment

Impossible Layout

Invalid Synchronization
```

大幅降低搜索空间。

---

# 8. Cost Model

静态 Cost Model 可以考虑：

```text
Arithmetic Intensity

Global Memory Traffic

Shared Memory Traffic

Register Pressure

Estimated Occupancy

Instruction Count

Tensor Core Utilization

Synchronization

Launch Count
```

但必须认识到：

> GPU 实际执行性能很难完全通过静态公式预测。

因为还存在：

```text
Cache Behavior

Instruction Scheduling

Bank Conflict

Latency Overlap

Input Distribution

Dynamic Divergence
```

等问题。

因此很多高性能系统使用：

```text
Static Pruning
+
Real Hardware Measurement
```

的组合。

---

# 9. Autotuning

例如 GEMM 有候选：

```text
BM = 64 / 128
BN = 64 / 128 / 256
BK = 16 / 32 / 64

Warps = 4 / 8

Stages = 2 / 3 / 4

MMA Shape = ...
```

搜索空间很快变成：

```text
hundreds
or
thousands
```

Autotuner：

```text
Candidates
    ↓
Prune
    ↓
Compile
    ↓
Run
    ↓
Measure
    ↓
Best Kernel
```

最终缓存 Key 往往不仅包含：

```text
Operator
```

还包括：

```text
GPU Architecture

Shape

Data Type

Layout

Alignment

Compiler Version
```

因为：

```text
同一个 MatMul
```

在不同输入条件下可能有完全不同的最优 Kernel。

---

# 10. Library Kernel 与 Compiler-generated Kernel

AI Compiler 不一定什么都自己生成。

例如一个标准 GEMM：

```text
MatMul
```

成熟库可能已经有极高质量实现。

因此 Compiler 需要决策：

```text
Custom Generated Kernel
```

还是：

```text
Vendor / Library Kernel
```

---

## 10.1 什么时候 Library 更合适

例如：

```text
标准 GEMM

常见 Data Type

常见 Layout

大型稳定 Shape
```

成熟库：

```text
长期手工调优
+
大量 Architecture-specific Kernel
+
Autotuning
```

通常非常强。

---

## 10.2 什么时候 Compiler-generated Kernel 更有优势

例如：

```text
MatMul
+
Bias
+
Activation
+
Custom Layout
```

如果调用库：

```text
GEMM
 ↓
Global Store

Bias Kernel
 ↓
Global Store

Activation Kernel
```

Compiler 可以生成：

```text
Fused GEMM Epilogue
```

减少中间 Global Memory Traffic。

因此现实 AI Compiler 常常是：

```text
Library
+
Generated Kernel
+
Fallback
```

混合体系。

---

# 11. 一个 GEMM 的完整 Lowering

现在把整个过程连起来。

高层：

```text
C = A × B
```

---

## Step 1：Shape / Layout Analysis

确认：

```text
M
N
K

A Stride
B Stride
C Stride

Transpose

Data Type
```

---

## Step 2：Tiling

选择：

```text
BM
BN
BK
```

得到：

```text
Block Tile
```

---

## Step 3：GPU Mapping

映射：

```text
Block Tile
    ↓
blockIdx

Warp Tile
    ↓
warp_id

Fragment
    ↓
lane_id
```

---

## Step 4：Memory Promotion

```text
A Global Tile
      ↓
Shared A

B Global Tile
      ↓
Shared B
```

---

## Step 5：Cooperative Load

确保：

```text
Warp Global Access
```

尽量 Coalesced。

---

## Step 6：Shared Layout

选择：

```text
Padding
Swizzle
Permutation
```

减少 Bank Conflict。

---

## Step 7：Pipeline

```text
Async Load Tile N+1
        ||
Compute Tile N
```

---

## Step 8：Register Fragment

```text
Shared
   ↓
Registers
```

构造：

```text
A Fragment
B Fragment
Accumulator Fragment
```

---

## Step 9：Instruction Selection

选择：

```text
Scalar FMA

Vector FMA

MMA

Warpgroup MMA
```

---

## Step 10：Epilogue Fusion

Accumulator：

```text
C
 ↓
Bias
 ↓
Activation
 ↓
Cast
 ↓
Store
```

尽量在 Register 中完成。

---

## Step 11：Tail Handling

生成：

```text
Mask
Padding
Remainder
Version
```

处理边界 Tile。

---

## Step 12：Target Lowering

例如：

```text
GPU / Vector / NVGPU
      ↓
NVVM
      ↓
NVPTX
      ↓
PTX
      ↓
cubin
```

---

## Step 13：Validation

测试：

```text
Correctness
Numerical Error
Race
Out-of-bounds
Synchronization
```

---

## Step 14：Benchmark

测量：

```text
Latency
Throughput
Memory Bandwidth
Compute Utilization
Resource Usage
```

最终选择方案。

---

# 12. GEMM Lowering Checklist

| 阶段 | 主要决策 | 需要验证 |
|---|---|---|
| Shape Analysis | `M/N/K`、stride、transpose | 地址和维度合法 |
| Tiling | `BM/BN/BK` | 数据复用与资源 |
| Block Mapping | Grid / Block | 输出覆盖完整 |
| Warp Mapping | Warp Tile | Lane 分工正确 |
| Memory Promotion | Global → Shared | 容量与生命周期 |
| Global Layout | Cooperative Load | Coalescing |
| Shared Layout | Padding / Swizzle | Bank Conflict |
| Register Layout | Fragment Distribution | Register Pressure |
| Pipeline | Stage / Buffer | Async Dependency |
| MMA Selection | Shape / dtype | Target Legality |
| Fusion | Epilogue | Live Range / Register |
| Tail | Mask / Padding | 无越界访问 |
| Target Lowering | NVVM / NVPTX | ABI / Address Space |
| Validation | Differential Test | 数值正确 |
| Tuning | Profile / Search | 最终真实性能 |

---

# 13. AI Compiler 的两层优化闭环

AI Compiler 通常存在两个不同层级的优化。

---

## 13.1 Graph-Level

例如：

```text
MatMul
  ↓
Bias
  ↓
ReLU
```

图层负责：

```text
Operator Fusion

Constant Folding

Layout Propagation

Shape Analysis

Dead Code Elimination

Kernel Grouping
```

输出：

```text
一个或多个 Kernel Groups
```

---

## 13.2 Kernel-Level

针对每个 Group：

```text
Tiling

Parallel Mapping

Memory Promotion

Warp Strategy

Reduction Strategy

Tensor Core

Pipeline

Autotuning
```

最终生成 GPU Kernel。

所以完整流程是：

```text
Model

 ↓

Graph Optimization

 ↓

Kernel Grouping

 ↓

GPU Kernel Optimization

 ↓

Code Generation

 ↓

Runtime
```

---

# 14. Compile Time 也是性能指标

AI Compiler 不能只追求：

```text
Fastest Kernel
```

假设：

```text
Autotuning = 5 minutes
```

而 Kernel：

```text
只运行一次
```

即使快了 10%，整体也完全不划算。

因此真实优化目标包括：

```text
Compile Time

JIT Latency

Runtime

Memory Usage

Cache Hit Rate

Deployment Complexity
```

可以理解为：

```text
Total Cost

=
Compilation
+
Launch
+
Execution
+
Transfer
+
Runtime Overhead
```

---

# 15. Kernel Cache

动态 Shape 场景如果每种 Shape 都重新编译：

```text
Shape A → Compile
Shape B → Compile
Shape C → Compile
Shape D → Compile
...
```

会产生严重 JIT 开销。

因此通常缓存：

```text
Device

Operator

Shape Bucket

Data Type

Layout

Compile Options
```

对应的：

```text
Compiled Kernel
```

下一次直接复用。

这也是 AI Compiler Runtime 的重要组成部分。

---

# 16. 从源码到部署的性能归因链

最终性能可以拆成：

```text
Application Time

├── Compile / JIT
│
├── Host Scheduling
│
├── H2D / D2H Transfer
│
├── Kernel Launch
│
├── Kernel Runtime
│
└── Synchronization
```

Kernel Runtime 又可以继续拆：

```text
Kernel Runtime

├── Global Memory
├── Shared Memory
├── Compute
├── Tensor Core
├── Synchronization
├── Divergence
└── Pipeline Stall
```

因此看到：

```text
Kernel 快了 30%
```

并不能直接推出：

```text
Application 快了 30%
```

如果程序真正瓶颈在：

```text
Host-device Transfer
```

或者：

```text
大量 Tiny Kernel Launch
```

Kernel 内优化收益可能几乎看不到。

---

# 17. SM 执行流水的简化模型

从编译器角度，可以把一个 SM 简化为：

```text
Resident Warps
      ↓
Warp Scheduler
      ↓
Issue
      ↓
Execution Pipelines
```

Execution Pipelines 可以包括：

```text
FP
INT
Load / Store
Tensor
Special Function
```

概念流程：

```text
Warp Ready
   ↓
Scheduler Select
   ↓
Issue Instruction
   ↓
Execute
   ↓
Write Result
   ↓
Dependency Resolved
```

如果 Warp 遇到：

```text
Global Load
```

结果尚未返回：

```text
Warp Not Ready
```

Scheduler 就选择其他 Warp。

所以 GPU 隐藏延迟的核心不是传统 CPU 那种依赖巨大乱序窗口，而是大量：

```text
Resident Warps
```

提供可切换的独立工作。

---

# 18. 为什么很多 Warp 仍然可能跑不满 GPU

假设理论 Occupancy 很高，但：

```text
所有 Warp
```

同时都在等待：

```text
Memory
```

那么：

```text
Warp Scheduler
```

仍然找不到 Ready Warp。

所以真正重要的是：

```text
Eligible Warp
```

而不仅是：

```text
Resident Warp
```

这也是：

```text
Occupancy 高
```

但性能仍然差的一个重要原因。

---

# 19. 编译器优化实际上在改变什么

例如 Loop Unroll：

```text
Before:

load
compute
load
compute
```

Unroll 后可能：

```text
load0
load1
load2

compute0
compute1
compute2
```

这样增加了：

```text
Instruction-level Parallelism
```

允许 Load 更早发出。

但同时：

```text
更多 Live Values
```

意味着：

```text
Register Pressure ↑
```

所以编译器做的很多优化不是简单：

```text
“减少指令数量”
```

而是在改变：

```text
Instruction Schedule
Dependency Graph
Resource Lifetime
Pipeline Pressure
```

---

# 20. 不同 GPU 为什么需要不同 Kernel

同一个 Kernel 在不同 GPU 上的最优配置可能不同，因为硬件具有不同：

```text
SM Count

Register Capacity

Shared Memory Capacity

Memory Bandwidth

Tensor Core Capability

Supported MMA Shape

Async Copy Capability

Scheduling Behavior
```

所以更合理的系统设计是：

```text
Generic Fallback
       +
Architecture-specific Variant
       +
Shape-specific Variant
```

而不是：

```text
一个 Kernel 打天下
```

---

# 21. Device Versioning

可以按 Device Signature 建立版本：

```text
GPU Architecture

Compute Capability

Shared Memory Capacity

Supported Matrix Operations

Other Relevant Features
```

然后：

```text
Device A
   ↓
Kernel Variant A

Device B
   ↓
Kernel Variant B
```

编译结果缓存之后：

```text
Runtime Dispatch
```

即可选择最佳实现。

---

# 22. GPU Compiler 正确性验证

优化 GPU Kernel 时，正确性永远必须先于性能。

需要验证至少包括：

```text
Out-of-bounds

Race Condition

Barrier Legality

Atomic Semantics

Dynamic Shape

Tail Tile

Numerical Error

Alignment

Address Space
```

---

## 22.1 Differential Testing

可以准备：

```text
Reference Implementation
```

例如 CPU 或成熟 Library。

然后：

```text
Reference Output
      VS
Generated Kernel Output
```

对大量：

```text
Random Shape
Random Data
Boundary Shape
Extreme Value
```

做差分测试。

---

## 22.2 Floating-point Tolerance

对于：

```text
Reduction
Softmax
MatMul
```

编译器改变：

```text
Reduction Order
FMA
Precision
Tensor Core
```

都可能改变低位结果。

因此验证通常使用：

```text
Absolute Error
Relative Error
ULP
```

而不是一律：

```text
memcmp()
```

---

# 23. 一个 GPU Compiler 的完整闭环

最终整个 GPU Compiler 可以压缩成：

```text
High-level Program

        ↓

Graph / Tensor IR

        ↓

Shape + Layout Analysis

        ↓

Fusion

        ↓

Loop / Tile Representation

        ↓

GPU Parallel Mapping

        ↓

Memory Promotion

        ↓

Layout Optimization

        ↓

Synchronization

        ↓

Warp-level Optimization

        ↓

MMA / Async Pipeline

        ↓

Resource Analysis

        ↓

Target Lowering

        ↓

PTX / cubin

        ↓

Correctness Validation

        ↓

Benchmark / Autotuning

        ↓

Kernel Cache

        ↓

Runtime Dispatch
```

没有某一个：

```text
Magic Pass
```

能够单独解决 GPU 性能问题。

真正的性能来自很多约束同时成立：

```text
Good Tile

+

Good Thread Mapping

+

Coalesced Global Memory

+

Low Shared Bank Conflict

+

Enough Data Reuse

+

Reasonable Register Pressure

+

Reasonable Shared Memory Usage

+

Correct Synchronization

+

Good Software Pipeline

+

Appropriate Tensor Core Instruction

+

Enough Parallelism
```

---

# 24. 从 CUDA Programmer 到 GPU Compiler Engineer 的思维变化

CUDA Programmer 通常看到：

```cpp
__global__ void kernel(...) {
    ...
}
```

然后问：

```text
怎样优化这个 Kernel？
```

GPU Compiler Engineer 则更早一步：

```text
这个 Kernel 为什么应该长成这样？
```

他需要选择：

```text
Loop Structure

Tile Shape

Thread Mapping

Memory Layout

Synchronization

Instruction Form
```

所以两个角色观察的是同一个系统的不同层次。

---

## CUDA Programmer

```text
Algorithm

  ↓ 手工

CUDA Kernel

  ↓

Compiler

  ↓

GPU
```

---

## GPU Compiler

```text
Algorithm / IR

  ↓ Compiler Transformation

CUDA-like Parallel Program

  ↓ Lowering

Target GPU IR

  ↓

GPU
```

---

# 25. 最终心智模型

学完整个 CUDA / GPU Compiler 部分后，最好在脑中同时保留两条链。

第一条是：

```text
CUDA Execution Model
```

```text
Host
 │
 │ Kernel Launch
 ▼
Grid
 │
 ├── Cluster        optional
 │
 └── Block
       │
       ├── Shared Memory
       ├── Block Barrier
       │
       └── Warp
             │
             ├── Divergence
             ├── Shuffle / Vote
             │
             └── Thread
                   │
                   └── Registers
```

继续落到硬件：

```text
Blocks
   ↓
SM
   ↓
Resident Warps
   ↓
Warp Scheduler
   ↓
Execution Pipelines
   ↓
L1 / Shared
   ↓
L2
   ↓
HBM
```

另一条是：

```text
GPU Compilation Model
```

```text
Tensor / Algorithm

      ↓

Loop

      ↓

Tiling

      ↓

GPU Parallel Mapping

      ↓

Memory Promotion

      ↓

Layout

      ↓

Synchronization

      ↓

Warp-level Optimization

      ↓

MMA / Software Pipeline

      ↓

Resource Analysis

      ↓

NVGPU / NVVM / NVPTX

      ↓

PTX / cubin

      ↓

GPU Execution
```

第一条回答：

```text
GPU 为什么这样运行？
```

第二条回答：

```text
Compiler 为什么要做这些变换？
```

一旦这两条链能够对应起来：

```text
Reduction

Scan

Histogram

Softmax

GEMM

Attention
```

就不再是一堆互相独立的 CUDA 技巧。

它们实际上都在重复解决几类基本问题：

```text
如何划分并行工作？

如何让 Warp 高效执行？

如何减少 Global Memory Traffic？

如何利用 Shared Memory / Register 复用数据？

如何在线程之间正确同步？

如何把计算映射到 GPU 专用硬件？

如何在资源约束下保持足够并发？

如何让 Compiler 自动完成这些决策？
```

这才是理解 CUDA Programming Model 和 GPU Compiler 最重要的主线。
