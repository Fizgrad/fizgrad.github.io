# MLIR：多层中间表示与渐进式 Lowering

# 1. 为什么需要 MLIR

LLVM IR 适合表达接近机器的控制流、标量运算和显式内存访问，却不会原生保留
“这是一次矩阵乘法”“这个张量采用什么布局”“这些循环可以映射到 GPU
workgroup”等高层语义。如果编译器过早把这些信息展开成低层循环和指针运算，后续
Pass 就必须从低层代码中重新猜测原来的结构，而且通常无法完整恢复。

MLIR（Multi-Level Intermediate Representation）不是另一套固定指令集，而是一套
**构造、验证和转换多层 IR 的编译器基础设施**。同一个程序可以在一个 Module 中
同时包含领域算子、结构化循环、向量操作、GPU 映射和接近 LLVM IR 的操作，然后用
一系列转换逐步降低抽象层级。

```mermaid
flowchart LR
    SOURCE["模型、DSL 或源语言"] --> HIGH["领域 IR<br/>图、张量、算子"]
    HIGH --> STRUCTURED["结构化 IR<br/>Linalg · Affine · SCF"]
    STRUCTURED --> MEMORY["内存与并行 IR<br/>MemRef · Vector · GPU"]
    MEMORY --> TARGET["目标相关 IR<br/>LLVM · NVVM · ROCDL · SPIR-V"]
    TARGET --> CODE["机器码或设备代码"]
```

这里的箭头表示语义逐渐具体化，不代表所有编译器都必须使用相同的 Dialect 或 Pass
顺序。CPU、GPU、NPU 和专用加速器可以共享一部分中层表示，再在目标相关阶段分流。

## 1.1 MLIR 与 LLVM IR 的关系

| 维度 | MLIR | LLVM IR |
|---|---|---|
| 抽象层级 | 可同时表达多个层级 | 主要面向低层、目标无关代码生成 |
| 指令集合 | Dialect 可扩展 | 核心指令和类型相对固定 |
| IR 结构 | Operation 可递归包含 Region 和 Block | Function、BasicBlock、Instruction 层次较固定 |
| 类型系统 | Dialect 可定义类型和属性 | 面向整数、浮点、向量、指针、结构体等低层类型 |
| 常见用途 | DSL、张量编译、循环变换、异构硬件映射 | 通用优化、指令选择和机器码生成 |
| 衔接方式 | 可降低到 MLIR 的 LLVM Dialect | LLVM Dialect 可再翻译成 LLVM IR |

MLIR 属于 `llvm-project`，但 **LLVM Dialect 不等于 LLVM IR**：前者仍是 MLIR
Operation、Type 和 Attribute 的集合，只是语义尽量映射 LLVM IR；完成相关合法化后，
`mlir-translate` 才能把它翻译为真正的 LLVM IR。

LLVM IR、Pass Manager 和 CodeGen 的低层细节见
[LLVM 编译器基础设施](post.html?slug=llvm_review)。

# 2. MLIR 的统一 IR 结构

MLIR 用一个核心结构承载不同抽象层级：Operation 产生和使用 Value，Operation 位于
Block 中，Block 位于 Region 中，而 Operation 自己又可以拥有 Region。这种递归结构
既能表示普通 CFG，也能表示循环体、条件分支、函数、模块和计算图。

```mermaid
flowchart TD
    OP["Operation"] -->|拥有 0..N 个| REGION["Region"]
    REGION -->|包含 0..N 个| BLOCK["Block"]
    BLOCK -->|按顺序包含| CHILD["Operation"]
    CHILD -->|结果| VALUE["Value"]
    VALUE -->|作为操作数| USER["Operation"]
    BLOCK -->|也可定义| ARG["Block Argument"]
    ARG -->|也是| VALUE
```

## 2.1 Operation 是唯一的基本实体

下面是一条整数加法：

```mlir
%sum = arith.addi %lhs, %rhs : i32
```

`arith.addi` 是 Operation 名称，其中 `arith` 是 Dialect 命名空间，`addi` 是
mnemonic。它使用两个 `i32` Value，并产生一个新的 `i32` Value `%sum`。

一条 Operation 最多可以包含以下部分：

| 部分 | 作用 |
|---|---|
| Name | 唯一标识操作，例如 `arith.addi` |
| Operands | 该操作使用的 SSA Value |
| Results | 该操作新产生的 SSA Value |
| Attributes / Properties | 编译期已知的固有配置或额外注解 |
| Regions | 嵌套的控制流或图结构 |
| Successors | CFG Region 中可能跳转到的 Block |
| Location | 源位置或转换过程中保留的来源信息 |

Operation 可以没有结果，也可以产生多个结果；可以只有普通操作数，也可以同时嵌套
Region。函数、循环和模块不是核心 IR 的特殊语法树节点，它们同样由具体 Dialect 的
Operation 表示。

## 2.2 Value、SSA 与类型

MLIR 中的 Value 只有两种来源：

1. Operation Result；
2. Block Argument。

每个 Value 都有确定的 Type，并遵守 SSA 的单定义规则。Value 名称只用于文本显示，
真正的 C++ IR 使用对象关系维护 def-use chain。

```mlir
func.func @compute(%arg0: i32, %arg1: i32) -> i32 {
  %c2 = arith.constant 2 : i32
  %sum = arith.addi %arg0, %arg1 : i32
  %result = arith.muli %sum, %c2 : i32
  func.return %result : i32
}
```

这里 `%arg0` 和 `%arg1` 是入口 Block Argument，其他 Value 都是 Operation Result。
`%sum` 的所有使用者可以通过 use-list 找到，因此替换一个定义时不需要扫描整份文本。

MLIR 还定义跨嵌套 Region 的层次化支配关系。一个 Value 能否在某处使用，不只取决于
文本顺序，还取决于 Region 的语义、Block 支配关系以及父 Operation 的隔离约束。

## 2.3 Region 和 Block

`scf.if` 用嵌套 Region 表示两个分支，并通过 `scf.yield` 把 Region 的结果交给外层
Operation：

```mlir
%max = scf.if %cond -> (i32) {
  scf.yield %lhs : i32
} else {
  scf.yield %rhs : i32
}
```

这段 IR 中：

- `scf.if` 是外层 Operation；
- then 和 else 各是一个 Region；
- 每个 Region 包含一个 Block；
- `scf.yield` 是 Region 的 terminator；
- 两条分支分别交出一个 `i32`，汇合为 `%max`。

Region 的控制流含义由父 Operation 决定。常见的 SSACFG Region 允许 Block 之间显式
跳转；Graph Region 则不要求 Block 具有 CFG 语义。因此不能把所有 Region 都理解成
“函数中的基本块集合”。

## 2.4 Block Argument 相当于什么

MLIR 通常用 Block Argument 表达控制流汇合处传入的值，而不是在文本中放置 LLVM
IR 风格的 `phi`：

```mlir
func.func @choose(%cond: i1, %lhs: i32, %rhs: i32) -> i32 {
  cf.cond_br %cond, ^left, ^right

^left:
  cf.br ^merge(%lhs : i32)

^right:
  cf.br ^merge(%rhs : i32)

^merge(%selected: i32):
  func.return %selected : i32
}
```

`^merge` 的参数 `%selected` 由每条前驱边提供，语义上对应“根据实际前驱选择输入值”。
结构化控制流继续 Lowering 到 LLVM Dialect 时，这类 Block Argument 可以转换为 LLVM
IR 的 PHI 节点。

## 2.5 递归结构为什么重要

传统扁平 CFG 很适合低层控制流，却不方便保留“这是一个循环”“这是一个原子执行的
图节点”“这是一个带隔离作用域的模块”等结构。MLIR Operation 可包含 Region，使
这些语义在需要时保持显式：

```text
builtin.module
└── func.func
    └── scf.for
        └── scf.if
            └── arith.addf
```

Lowering 可以逐层展开其中一部分，而不用一次把整个程序压平。例如先把张量算子转成
`scf.for`，仍保留函数和模块；之后再把 `scf` 转成 `cf`，最后才进入 LLVM Dialect。

# 3. Type、Attribute、Property 与 Location

## 3.1 常见 Type

```mlir
i32
f16
index
vector<8xf32>
tensor<4x?xf32>
memref<4x?xf32>
!gpu.async.token
```

- `i32`、`f16` 是标量类型；
- `index` 表示适合索引、维度和循环边界的整数，其目标位宽由后续 Lowering 决定；
- `vector<8xf32>` 表示固定形状的向量值；
- `tensor<4x?xf32>` 是秩为 2 的张量，第二维动态；
- `memref<4x?xf32>` 表示带形状和布局信息的内存引用；
- `!gpu.async.token` 是 GPU Dialect 定义的自定义类型。

`index` 不是指针，也不保证永远等于 `i64`。把它降低到某个目标时，编译器会依据目标
数据布局选择合适表示；需要和固定宽度整数交互时应使用显式转换。

## 3.2 Attribute、Property 与 SSA Value

先区分运行期数据和编译期配置。Attribute 和 Property 都表示编译期间直接记录在 IR
中的数据，Pass 可以改写它们，但它们不是程序运行时沿 def-use chain 传递的值；后者
必须使用 SSA Value：

```mlir
%c4 = arith.constant 4 : index
%zero = arith.constant 0.0 : f32
```

这里 `4` 和 `0.0` 是 Attribute，`%c4` 和 `%zero` 是由 Operation 产生、可以沿
def-use chain 流动的 SSA Value。二者不能因为都写着“常量”就混为一谈：Attribute
配置 Operation，Value 则参与程序的数据依赖。

Attribute 与 Property 的区别也不是“Attribute 只是元数据，Property 才影响语义”。
二者都可以是 Operation 语义的一部分，主要区别在于存储模型和使用范围：

| 对比项 | Attribute | Property |
|---|---|---|
| 内存表示 | `Attribute` 是值语义句柄，底层存储通常由 `MLIRContext` uniquing | 保存在该 Operation 固定类型的 Properties storage 中 |
| 可变方式 | Attribute 值本身通常不可变；修改字段意味着换成另一个 Attribute | 每个 Operation 拥有自己的值，可通过生成的 setter 修改 |
| 复用范围 | 是通用 MLIR 对象，可以共享、嵌套进 Array/Dictionary，也可以被 Type 引用 | 只属于声明它的 Operation，不是可脱离 Operation 复用的一类 IR 对象 |
| C++ 类型 | `IntegerAttr`、`StringAttr`、`AffineMapAttr` 或自定义 Attribute | 可以直接使用 `int64_t`、枚举、`SmallVector` 或 Operation 定义的结构 |
| 文本与字节码 | Attribute 自己具有统一的解析、打印和存储模型 | 必须能够转换成 Attribute 以支持 generic form，并提供复制、比较、哈希和序列化逻辑；ODS 可以生成这些代码 |
| 适合内容 | 可复用的结构化编译期值，或附加到 Operation 的开放式注解 | Operation 固定且固有的配置，尤其是适合直接用 C++ 类型保存的字段 |

这里还要区分 **Attribute 值** 和 **Operation 的 attribute dictionary**。现代 MLIR
Operation 的存储在概念上接近：

```text
Operation
├── 固定布局的 Properties storage
│   ├── Attribute-backed 固有字段，例如 StringAttr
│   └── 原生 Property 字段，例如 int64_t 或 enum
└── discardable attribute dictionary
    └── 其他 Dialect 附加的注解
```

固有字段决定 Operation 自己的含义并由该 Operation 验证。它既可以保存一个 Attribute
句柄，也可以是非 Attribute-backed 的原生 Property。Discardable attribute 的含义由
外部 Dialect 定义，可以附加到兼容的 Operation 上，而不需要成为该 Operation 固定
Properties 结构的一部分。

例如：

```mlir
module @kernel attributes {test.note = "hot"} {}
```

使用 `--mlir-print-op-generic` 后，其核心结构是：

```mlir
"builtin.module"() <{sym_name = "kernel"}> ({
^bb0:
}) {test.note = "hot"} : () -> ()
```

`sym_name` 是 `builtin.module` 固有的字段，保存在 Properties storage 中，但字段值仍然
是一个 `StringAttr`；`test.note` 则是额外附加的 discardable attribute。由此可以看出，
`<{...}>` 表示的是 generic form 中的 properties dictionary，并不意味着其中每个值都
是原生 C++ Property；固有的 Attribute-backed 字段也会出现在这里。后面的 `{...}`
才是 discardable attribute dictionary。自定义打印语法可以把二者改写或省略，因此
不能只凭一对括号判断 C++ 存储类型。

ODS 可以在同一个 Operation 中同时声明 Attribute-backed 字段和原生 Property：

```tablegen
let arguments = (ins
  AnyTensor:$input,
  AffineMapAttr:$layout,
  DefaultValuedProp<I64Prop, "1">:$stages
);
```

生成的存储在概念上接近：

```cpp
struct Properties {
  AffineMapAttr layout; // 指向 MLIRContext 中 uniqued 的 Attribute
  int64_t stages = 1;   // 当前 Operation 自己的原生 Property
};
```

`layout` 和 `stages` 都是 Operation 的固有语义，差别只是前者采用通用 Attribute 表示，
后者采用直接的 C++ 存储。Property 默认仍会参与 Operation 的比较和哈希，也必须能在文本、
字节码以及 clone 过程中正确保存，不能用来偷偷存放临时分析缓存或悬空 C++ 指针。

选择时可以按下面的顺序判断：

1. 运行时才知道，或者需要参与 def-use chain：使用 SSA Value；
2. Operation 固定拥有的简单配置，希望直接使用 C++ 类型：使用 Property；
3. 需要复用、嵌套或使用现有 MLIR Attribute API 的编译期对象：使用 Attribute-backed 字段；
4. 由外部 Dialect 附加、不是 Operation 固定结构的注解：使用 discardable attribute；
5. 只在某个 Pass 执行期间存在的推导结果：放进 Analysis，而不是写入 Property。

例如静态 tile size 可以使用 Attribute 或 Property；运行期才知道的 tile size 必须使用
SSA Value。具体选择 Attribute 还是 Property，要看它是否需要 Attribute 的通用组合能力，
以及直接使用 C++ 存储是否更适合该 Operation 的固定接口。

## 3.3 Location

Location 记录 Operation 来自哪里。它可以指向源文件行列，也可以组合多个来源或表示
一次调用展开关系：

```mlir
%sum = arith.addi %lhs, %rhs : i32 loc("kernel.cpp":12:7)
```

诊断、调试信息和转换后问题定位依赖 Location。创建替代 Operation 时应尽量继承或
合理合并原 Location，而不是全部使用未知位置。

## 3.4 自定义语法与通用语法

Dialect 可以为 Operation 定义易读的 custom assembly format；MLIR 同时保留统一的
generic form。两种文本形式对应同一份内存 IR，custom form 不是另一种语义。

通用形式的核心轮廓是：

```text
%result = "dialect.operation"(%operand) <{properties}> {attributes}
    : (operand-types) -> result-types
```

在调试 parser/printer、自定义 Dialect 尚未提供打印格式或需要观察完整字段时，generic
form 很有用。`mlir-opt --mlir-print-op-generic` 可以要求打印通用形式。

# 4. Dialect：让多种抽象共存

Dialect 为 Operation、Type 和 Attribute 提供命名空间与语义边界。同一个 Module 可以
同时注册并使用多个 Dialect；转换 Pass 可以消费一种 Dialect，再产生另一种 Dialect。

## 4.1 常见 Dialect 的职责

| Dialect | 主要表达内容 |
|---|---|
| `builtin` | `module`、基础 Type 和通用容器 |
| `func` | 函数、调用与返回 |
| `arith`、`math` | 整数、浮点和数学运算 |
| `tensor` | 值语义张量的构造、切片和形状操作 |
| `linalg` | 结构化线性代数与通用张量计算 |
| `affine` | 仿射循环、条件和内存访问 |
| `scf` | `for`、`while`、`if` 等结构化控制流 |
| `cf` | 显式基本块跳转 |
| `memref` | 带 shape、stride、layout 的内存引用 |
| `vector` | 目标无关的多维向量操作 |
| `gpu` | grid、block、thread、barrier 和设备模块 |
| `nvgpu`、`amdgpu` | NVIDIA/AMD GPU 的 MMA、异步拷贝等目标相关中层能力 |
| `nvvm`、`rocdl` | 接近 NVIDIA/AMD LLVM intrinsic 的目标操作 |
| `spirv` | SPIR-V 模块、类型和指令 |
| `llvm` | 可映射到 LLVM IR 的低层操作和类型 |
| `transform` | 用 IR 描述如何匹配和调度其他 IR 的变换 |

Dialect 之间不存在唯一的全局“高低顺序”。`vector` 可能 Lowering 到 `scf`，也可能
直接映射目标向量指令；`linalg` 可以在 tensor 语义下优化，也可以在 buffer 语义下
执行。真正的层级由具体编译管线、目标和 Operation 语义决定。

## 4.2 Dialect 边界如何协作

如果每个 Dialect 只认识自己的具体 Operation，通用 Pass 会迅速退化成大量类型判断。
MLIR 使用 Trait 和 Interface 暴露跨 Dialect 的共同性质：

| 机制 | 回答的问题 | 示例 |
|---|---|---|
| Trait | 一个 Operation 静态具有什么性质 | 无副作用、操作数与结果同类型 |
| OpInterface | Operation 能提供什么行为 | 类型推导、分块、内存效果查询 |
| TypeInterface | Type 能提供什么行为 | 数据布局或分片信息 |
| DialectInterface | 整个 Dialect 如何参与某种机制 | inlining、bufferization 支持 |

例如通用 DCE 可以通过 `MemoryEffectOpInterface` 判断 Operation 是否具有可观察副作用；
通用 Tiling 变换可以调用 `TilingInterface`，而不必硬编码所有可分块算子的类名。

Trait 主要声明局部且静态的性质，Interface 则带有可调用的方法。ODS 声明了某个
Operation 实现 Interface 后，仍需要提供符合契约的行为实现；写上名字并不会自动
生成完整算法。

# 5. Tensor、Shape 与 Linalg

Tensor 编译最容易混淆三件事：Type 中知道多少 Shape、运行期怎样取得动态维度，以及
算子用什么方式描述迭代空间。`tensor`、Shape Dialect 和 `linalg` 分别覆盖其中不同的
部分。

## 5.1 静态维度、动态维度与未知秩

```text
tensor<2x4xf32>    // rank = 2，两个维度都静态已知
tensor<?x4xf32>    // rank = 2，第 0 维运行期决定
tensor<*xf32>      // rank 本身也未知
```

`?` 只表示该维度没有编码进 Type，并不会自动产生保存维度的 SSA Value。需要参与循环
边界、分配或 Guard 时，应显式读取动态维度：

```mlir
func.func @rows(%arg: tensor<?x4xf32>) -> index {
  %c0 = arith.constant 0 : index
  %rows = tensor.dim %arg, %c0 : tensor<?x4xf32>
  func.return %rows : index
}
```

如果某一维在 Type 中静态已知，`tensor.dim` 通常可以折叠成常量。动态 Shape 不等于
未知秩：`tensor<?x4xf32>` 的秩和第二维仍然已知，许多按维度生成循环的变换依然可用；
`tensor<*xf32>` 则连维度数量都要在运行期处理，能使用的静态变换更少。

`tensor.cast` 只在兼容的 Tensor Type 之间增加或移除静态 Shape、甚至 Rank 信息，
不会重新排列元素，也不是一次数据复制。真正改变元素组织方式需要
`tensor.expand_shape`、`tensor.collapse_shape`、切片操作或相应的领域算子。

MLIR 的 C++ 变换经常同时处理静态和动态尺寸。`OpFoldResult` 可以保存一个 Attribute
或 SSA Value，因此同一组尺寸可以表示为 `[64, %n, 32]`，而不必先把所有静态常量都
物化成 Operation：

```cpp
mlir::SmallVector<mlir::OpFoldResult> sizes =
    mlir::tensor::getMixedSizes(builder, loc, tensorValue);
```

其中静态维度通常是 `IntegerAttr`，动态维度是 `tensor.dim` 等 Operation 的 Result。
Tiling、切片和 Shape 辅助 API 中的 `mixed offsets/sizes/strides` 都采用类似约定。

## 5.2 Shape 推导、运行期计算与约束

Shape 推导至少包含三个不同问题：

| 问题 | 典型机制 | 结果 |
|---|---|---|
| 根据 Operand Type 和 Attribute 推出 Result Type | `InferTypeOpInterface`、`InferShapedTypeOpInterface` | 编译期 Type 或 Shape 分量 |
| 把动态结果维度变成可计算的 SSA Value | `ReifyRankedShapedTypeOpInterface`、`tensor.dim` | `index` Value |
| 验证运行期 Shape 关系 | Shape Dialect、`cf.assert` 或运行时 Guard | 约束成立后才能进入的路径 |

Shape Dialect 能把 Shape 本身表示为值。例如：

```mlir
func.func @shape_value(%arg: tensor<?x4xf32>) -> !shape.shape {
  %shape = shape.shape_of %arg : tensor<?x4xf32> -> !shape.shape
  func.return %shape : !shape.shape
}
```

`!shape.shape` 表示一组 Extent；`!shape.size` 表示单个尺寸；`!shape.witness` 表示某项
约束是否成立。`shape.broadcast` 可以计算广播后的 Shape，
`shape.cstr_broadcastable` 可以产生广播约束的 Witness，后续再通过 `shape.assuming`
表达“只有约束成立时这些推导才有效”。不同项目也可能不用 Shape Dialect，而是直接用
`tensor.dim`、`arith` 和自定义 Shape IR 表达相同信息。

类型推导成功只说明编译器能构造一个结果 Type，不代表所有运行期输入一定合法。例如
两个 `tensor<?x?xf32>` 在 Type 上兼容，并不能证明矩阵乘法的归约维度相等；静态维度
可以由 Verifier 检查，动态维度则需要 Guard、Shape Constraint 或上层运行时契约。

## 5.3 Named Linalg Operation 与 DPS

下面的 `linalg.matmul` 保留了矩阵乘法、迭代空间和归约关系：

```mlir
module {
  func.func @matmul(
      %a: tensor<64x128xf32>,
      %b: tensor<128x32xf32>,
      %init: tensor<64x32xf32>) -> tensor<64x32xf32> {
    %result = linalg.matmul
        ins(%a, %b : tensor<64x128xf32>, tensor<128x32xf32>)
        outs(%init : tensor<64x32xf32>) -> tensor<64x32xf32>
    func.return %result : tensor<64x32xf32>
  }
}
```

`ins` 是只读输入，`outs` 是 Destination-Passing Style（DPS）的逻辑目的地。Tensor
仍采用值语义，所以 `%result` 是新的 SSA Value；不能仅凭 `outs(%init)` 断定运行时
一定覆盖 `%init`。Bufferization 只有在别名和读写分析证明安全时才会复用其 Buffer。

Named Operation 不是黑盒库调用。`linalg.matmul` 公开自己的迭代空间、Indexing Map、
输入输出和标量区域语义，因此通用 Tiling、Fusion、Vectorization 和 Bufferization
仍能处理它。Named form 便于识别特定算子，`linalg.generic` 则把同一结构完整展开。

## 5.4 读懂 `linalg.generic`

矩阵乘法可以写成下面的动态 Shape 版本：

```mlir
#a = affine_map<(i, j, k) -> (i, k)>
#b = affine_map<(i, j, k) -> (k, j)>
#c = affine_map<(i, j, k) -> (i, j)>

func.func @matmul_generic(
    %lhs: tensor<?x?xf32>,
    %rhs: tensor<?x?xf32>,
    %init: tensor<?x?xf32>) -> tensor<?x?xf32> {
  %result = linalg.generic {
      indexing_maps = [#a, #b, #c],
      iterator_types = ["parallel", "parallel", "reduction"]
    }
    ins(%lhs, %rhs : tensor<?x?xf32>, tensor<?x?xf32>)
    outs(%init : tensor<?x?xf32>) {
  ^bb0(%x: f32, %y: f32, %acc: f32):
    %product = arith.mulf %x, %y : f32
    %next = arith.addf %acc, %product : f32
    linalg.yield %next : f32
  } -> tensor<?x?xf32>
  func.return %result : tensor<?x?xf32>
}
```

这段 IR 可以按四层阅读：

1. `(i, j, k)` 是完整逻辑迭代空间；
2. 三个 Indexing Map 分别说明本次迭代访问 `lhs[i, k]`、`rhs[k, j]` 和
   `out[i, j]`；
3. `i`、`j` 是 Parallel Iterator，`k` 是 Reduction Iterator；
4. Region 每次只处理标量，`%acc` 是 `outs` 当前元素，`linalg.yield` 给出更新值。

Indexing Map 描述的是“迭代坐标怎样映射到 Operand 下标”，不是实际内存地址公式；
后者还受 MemRef Layout 和 Bufferization 影响。`iterator_types` 也不直接指定循环顺序、
Tile Size 或 GPU 线程号，它只给出变换必须保持的并行与归约语义。

## 5.5 结构语义怎样进入后端

一条可能的 CPU 路径如下：

```mermaid
flowchart TD
    LINALG["Linalg<br/>算子、迭代空间、Indexing Map"] --> TILE["Tiling / Fusion<br/>选择工作集与局部性"]
    TILE --> VECTOR["Vectorization<br/>vector.contract 等"]
    VECTOR --> BUFFER["Bufferization<br/>Tensor 值映射到 Buffer"]
    BUFFER --> LOOP["SCF / Affine / CF<br/>显式循环与控制流"]
    LOOP --> LLVM_D["LLVM Dialect<br/>指针、调用、低层控制流"]
    LLVM_D --> LLVM_IR["LLVM IR 与目标后端"]
```

GPU 路径会进一步把迭代映射到 grid、block、warp 和 thread，并明确 global、workgroup、
private 等地址空间。重要的不是背诵一条固定管线，而是每一步都能回答：输入需要什么
不变量、消耗了哪些高层语义、引入了哪些实现决策，以及输出还残留哪些目标不接受的
Operation 和 Type。

# 6. 用 ODS 和 TableGen 定义 Operation

直接继承 C++ 类可以定义 Operation，但大量 parser、printer、builder、accessor 和
verifier 样板代码很容易不一致。MLIR 通常使用 ODS（Operation Definition
Specification）在 TableGen 文件中声明 Operation 的结构和约束，再生成 C++ 接口与
文档。

## 6.1 一个最小的自定义 Operation

下面的 ODS 片段定义 `toy.add` 的核心结构：

```tablegen
include "mlir/IR/OpBase.td"
include "mlir/Interfaces/InferTypeOpInterface.td"
include "mlir/Interfaces/SideEffectInterfaces.td"

def Toy_Dialect : Dialect {
  let name = "toy";
  let cppNamespace = "::toy";
}

class Toy_Op<string mnemonic, list<Trait> traits = []>
    : Op<Toy_Dialect, mnemonic, traits>;

def Toy_AddOp : Toy_Op<"add", [Pure, SameOperandsAndResultType]> {
  let summary = "element-wise addition";

  let arguments = (ins AnyTensor:$lhs, AnyTensor:$rhs);
  let results = (outs AnyTensor:$result);

  let assemblyFormat =
      "$lhs `,` $rhs attr-dict `:` type($result)";
}
```

它声明了：

- 文本名称为 `toy.add`；
- 有两个命名操作数和一个结果；
- 操作数与结果类型相同；
- Operation 没有可观察副作用；
- 自定义文本格式如何解析和打印。

生成的 C++ wrapper 允许使用 `op.getLhs()`、`op.getRhs()`、`op.getResult()` 等类型化
接口，而不必按下标访问裸 `Operation`。ODS 还能生成声明、定义、验证逻辑的一部分及
Dialect 文档。

这段声明仍不足以保证两个 Tensor 的 shape 可逐元素相加。ODS 适合表达局部结构约束；
涉及多个操作数之间的动态关系时，应补充自定义 `verify()`，并给出能定位具体错误的
诊断。

## 6.2 ODS 不会替你实现什么

ODS 描述的是 Operation 契约，不会自动完成：

- 高层语义到低层 Dialect 的 Lowering；
- 成本模型和变换时机；
- 复杂 shape 推导；
- Buffer 的别名和生命周期决策；
- 目标指令选择。

这些行为通常通过 Interface、RewritePattern、Pass 和 Dialect Conversion 实现。

## 6.3 Operation、Op wrapper 和 ODS 的关系

| 名称 | 含义 |
|---|---|
| `mlir::Operation` | 运行期统一 IR 节点，保存操作数、结果、Properties、discardable attributes 和 Region |
| `toy::AddOp` | 对特定 Operation 的轻量类型化 C++ wrapper |
| ODS/TableGen 定义 | 用声明式方式生成 wrapper、约束和注册代码 |

`toy::AddOp` 通常像句柄一样包装 `Operation *`，并不是在 IR 里额外复制一份节点。
通用代码可以操作 `Operation *`，领域代码则使用类型化 wrapper 获得更安全的 API。

## 6.4 从哪些 C++ 对象进入 MLIR

MLIR C++ API 的对象关系可以先按所有权和职责理解：

```mermaid
flowchart TD
    REG["DialectRegistry<br/>记录可用 Dialect 与 Extension"] --> CTX["MLIRContext<br/>加载 Dialect、uniquing、诊断"]
    CTX --> TYPE["Type · Attribute · Location<br/>依赖 Context 存储"]
    CTX --> TREE["Operation 树<br/>由 OwningOpRef 或父 Operation 拥有"]
    BUILDER["OpBuilder<br/>Context + insertion point"] --> TREE
    WRAPPER["AddOp · FuncOp 等 wrapper<br/>不拥有底层 Operation"] --> TREE
    PM["PassManager / Rewriter<br/>按契约分析和修改 IR"] --> TREE
```

| 对象 | 作用与容易忽略的边界 |
|---|---|
| `DialectRegistry` | 保存“怎样加载 Dialect/Extension”的注册信息；注册不等于已经实例化 Dialect |
| `MLIRContext` | 管理 Dialect 实例、Type/Attribute uniquing、诊断和线程配置；必须比依赖它的 IR 活得更久 |
| `Operation` / `Block` / `Region` | 真正的可变 IR 树；父节点通常拥有子节点 |
| `OwningOpRef<T>` | RAII 拥有一个脱离父节点的顶层 Operation，常用于解析得到的 `ModuleOp` |
| `Value`、`Type`、`Attribute`、`FuncOp` | 轻量句柄，不延长底层对象或 Context 的生命期 |
| `OpBuilder` | 按当前 insertion point 创建并插入 Operation；它不拥有 Module |
| `PatternRewriter` | Pattern 中使用的 Builder，还负责通知 driver 替换、删除和原地修改 |

`MLIRContext context(registry)` 会把 Registry 附加到 Context，但 Dialect 通常按需加载。
Parser 会根据遇到的 Operation 加载已注册 Dialect；直接用 Builder 构造 IR 前，可以显式
调用 `getOrLoadDialect<T>()`，或在小工具中使用 `loadAllAvailableDialects()`。生产工具更
适合只注册和加载真正使用的 Dialect，避免不必要的初始化。

## 6.5 解析、遍历与构造 IR

解析文件时，顶层所有权由 `OwningOpRef` 接管：

```cpp
#include "mlir/Dialect/Arith/IR/Arith.h"
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include "mlir/IR/BuiltinOps.h"
#include "mlir/Parser/Parser.h"
#include "llvm/Support/raw_ostream.h"

mlir::DialectRegistry registry;
registry.insert<mlir::arith::ArithDialect, mlir::func::FuncDialect>();
mlir::MLIRContext context(registry);
mlir::ParserConfig parserConfig(&context);

mlir::OwningOpRef<mlir::ModuleOp> module =
    mlir::parseSourceFile<mlir::ModuleOp>(argv[1], parserConfig);
if (!module)
  return 1;

module->walk([](mlir::Operation *op) {
  llvm::outs() << op->getName() << '\n';
});
```

构造 IR 时，最关键的状态是 insertion point。下面的代码已经用 MLIR 22 API 编译运行，
会产生一个返回 `40 + 2` 的函数：

```cpp
#include "mlir/Dialect/Arith/IR/Arith.h"
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include "mlir/IR/BuiltinOps.h"
#include "mlir/IR/Builders.h"
#include "mlir/IR/Verifier.h"
#include "llvm/Support/raw_ostream.h"

int main() {
  mlir::DialectRegistry registry;
  registry.insert<mlir::arith::ArithDialect, mlir::func::FuncDialect>();
  mlir::MLIRContext context(registry);
  context.loadAllAvailableDialects();

  mlir::OpBuilder builder(&context);
  mlir::Location loc = builder.getUnknownLoc();
  mlir::OwningOpRef<mlir::ModuleOp> module(mlir::ModuleOp::create(loc));
  builder.setInsertionPointToStart(module->getBody());

  auto functionType = builder.getFunctionType({}, {builder.getI32Type()});
  auto function = mlir::func::FuncOp::create(
      builder, loc, "generated", functionType);
  mlir::Block *entry = function.addEntryBlock();
  builder.setInsertionPointToStart(entry);

  auto lhs = mlir::arith::ConstantIntOp::create(builder, loc, 40, 32);
  auto rhs = mlir::arith::ConstantIntOp::create(builder, loc, 2, 32);
  auto sum = mlir::arith::AddIOp::create(builder, loc, lhs, rhs);
  mlir::func::ReturnOp::create(builder, loc, sum.getResult());

  if (mlir::failed(mlir::verify(*module)))
    return 1;
  module->print(llvm::outs());
  return 0;
}
```

创建 `FuncOp` 时 insertion point 仍在 Module，函数因此插入 Module；随后把 insertion
point 移到 Entry Block，常量、加法和 Return 才会进入函数体。Detached Operation
必须被插入某个父节点或交给 `OwningOpRef`，否则裸 wrapper 并不能表达所有权，容易
泄漏；拥有者销毁 Operation 后，原有 wrapper 和 Value 也立即失效。Pattern 内则应
使用传入的 Rewriter，不要另建 Builder 绕过 driver。

# 7. Pattern Rewriting：做局部等价变换

Pattern Rewriting 把转换拆成“匹配条件”和“如何替换”。Pattern driver 负责选择、调度
和重复应用 Pattern，`PatternRewriter` 负责通知 driver 每次 IR 变更。

下面的 Pattern 把 `%x + 0` 替换为 `%x`：

```cpp
struct FoldAddZero final : mlir::OpRewritePattern<mlir::arith::AddIOp> {
  using OpRewritePattern::OpRewritePattern;

  mlir::LogicalResult matchAndRewrite(
      mlir::arith::AddIOp op,
      mlir::PatternRewriter &rewriter) const override {
    if (!mlir::matchPattern(op.getRhs(), mlir::m_Zero()))
      return rewriter.notifyMatchFailure(op, "rhs is not zero");

    rewriter.replaceOp(op, op.getLhs());
    return mlir::success();
  }
};
```

这段代码只在整数加法右操作数能匹配零常量时成功。`replaceOp` 会把旧 Operation 所有
结果的使用改为新 Value，再删除旧 Operation。

Pattern driver 可能缓存匹配状态或维护 worklist，因此 Pattern 内的创建、替换、删除和
原地修改必须通过 `PatternRewriter` 完成，不能绕过它直接破坏 IR。

## 7.1 Pattern、Canonicalization 与 CSE

- **RewritePattern**：一条局部匹配和替换规则；
- **Canonicalization**：反复应用各 Operation 注册的规范化 Pattern 和 fold hook，趋向
  更统一、更简单的形式；
- **CSE**：根据等价性和副作用信息消除公共子表达式；
- **Pass**：在指定 Operation 层级组织完整分析或转换过程。

`canonicalize` 不是“自动运行全部优化”，也不保证得到全局最优 IR。规范化规则应该
收敛到稳定方向，避免 `A → B` 与另一条 `B → A` 反复震荡。需要成本模型、全局分析
或严格阶段边界的转换更适合放进专用 Pass。

## 7.2 原地修改与替换

当 Operation 的结果和结构保持不变，只更新 Attribute、Property、Operand 或 Location 时，可以
使用 `modifyOpInPlace`。如果结果数量或类型变化，应创建新的 Operation 并替换旧结果。
这一区分能让 driver 正确维护 use-list、监听器和失效状态。

# 8. Pass 与 Pass Pipeline

Pass 是分析或变换的调度单元，并锚定在某种 Operation 层级。一个 `func.func` Pass
处理函数内部 IR；一个 `builtin.module` Pass 可以处理符号、跨函数关系或嵌套管线。

```cpp
struct SimplifyIntegerPass final
    : mlir::PassWrapper<SimplifyIntegerPass,
                       mlir::OperationPass<mlir::func::FuncOp>> {
  void runOnOperation() override {
    mlir::RewritePatternSet patterns(&getContext());
    patterns.add<FoldAddZero>(&getContext());

    if (mlir::failed(mlir::applyPatternsGreedily(
            getOperation(), std::move(patterns))))
      signalPassFailure();
  }
};
```

如果 Pass 可能创建其他 Dialect 的 Operation，应把对应 Dialect 声明为 dependent
dialect。Pass 发现输入不满足契约或无法保持合法 IR 时，应报告诊断并调用
`signalPassFailure()`，使后续管线停止。

## 8.1 为什么 Pipeline 具有嵌套结构

MLIR IR 本身是嵌套的，Pass Manager 也按 Operation 层级嵌套：

```bash
mlir-opt input.mlir \
  --pass-pipeline='builtin.module(func.func(canonicalize,cse))'
```

这表示先进入 `builtin.module`，再对其中可调度的 `func.func` 运行 `canonicalize` 和
`cse`。不能只根据文本先后假设任意 Pass 都能运行在任意 Operation 上；Pass 的锚点、
输入契约和并发限制都必须满足。

## 8.2 Analysis 的保存与失效

Pass 可以请求支配树、数据流结果等 Analysis。修改 IR 后，只有仍然正确的 Analysis
才能标记为 preserved；其余缓存必须失效。错误地保留过期分析会让后续 Pass 在错误
事实之上继续变换，往往比立即崩溃更难定位。

# 9. Dialect Conversion：定义阶段出口

普通 Rewrite 关心“这个局部结构能否换成另一个结构”；Dialect Conversion 进一步定义
“完成本阶段后，哪些 Operation 和 Type 被允许存在”。它由三个核心部分组成：

1. `ConversionTarget`：声明合法、动态合法和非法的 Operation/Dialect；
2. Conversion Pattern：把非法 Operation 改写为目标可接受的形式；
3. `TypeConverter`：在需要时转换 Type 和 Region/Block 签名。

```mermaid
flowchart LR
    INPUT["输入 IR"] --> CHECK{"Operation 合法？"}
    CHECK -->|是| KEEP["保留"]
    CHECK -->|否| PATTERN["寻找 Conversion Pattern"]
    PATTERN --> REWRITE["重写 Operation"]
    REWRITE --> TYPE["转换结果、参数和类型边界"]
    TYPE --> VERIFY{"输出全部满足 Target？"}
    VERIFY -->|是| DONE["Conversion 成功"]
    VERIFY -->|否| FAIL["报告失败"]
```

## 9.1 一个转换 Pattern

下面展示 `toy.add` Lowering 到 `arith.addf` 的核心形态：

```cpp
struct LowerToyAdd final
    : mlir::OpConversionPattern<toy::AddOp> {
  using OpConversionPattern::OpConversionPattern;

  mlir::LogicalResult matchAndRewrite(
      toy::AddOp op,
      OpAdaptor adaptor,
      mlir::ConversionPatternRewriter &rewriter) const override {
    rewriter.replaceOpWithNewOp<mlir::arith::AddFOp>(
        op, adaptor.getLhs(), adaptor.getRhs());
    return mlir::success();
  }
};
```

`adaptor` 提供按 `TypeConverter` 重映射后的操作数；直接使用旧 Operation 的 Operand
可能把源类型错误地接到目标 Operation 上。实际实现还应检查 Element Type、Shape
和目标 `arith.addf` 的约束。

## 9.2 Full、Partial 与 Analysis Conversion

| 模式 | 成功条件 | 适用场景 |
|---|---|---|
| Full Conversion | 所有要求合法化的 IR 都满足 Target | 阶段边界、进入目标后端前 |
| Partial Conversion | 明确非法的内容必须消失，未声明内容可保留 | 分阶段 Lowering |
| Analysis Conversion | 只分析哪些 Operation 可被合法化，不真正改写 | 诊断和规划 |

阶段出口如果要求“不能再出现任何 `toy` Operation”，就应把 Toy Dialect 标记为非法并
执行 Full Conversion。只运行几条 Rewrite，却不检查残留非法 Operation，容易把错误
拖到更低层才暴露。

## 9.3 TypeConverter 与 Materialization

类型变换可能不是一对一。例如一个高层 Tensor Type 可以降低为 MemRef，也可能展开成
多个底层值。`TypeConverter` 描述源 Type 如何映射到目标 Type，并能更新函数签名和
Block Argument。

如果已转换 Value 仍被暂未转换的源 Operation 使用，边界上可能需要 source
materialization；反过来，未转换 Value 要传给目标 Operation 时可能需要 target
materialization。它们会显式生成桥接 IR，而不是让 Value 的 Type 在 use-list 中悄悄
改变。

`builtin.unrealized_conversion_cast` 常被用于暂时连接尚未完全协调的类型边界，但它
不是最终代码生成方案。完整管线应继续消除这些占位转换，或证明目标阶段允许保留。

## 9.4 Rewrite、Conversion 与 Lowering 的区别

| 名称 | 重点 |
|---|---|
| Rewrite | 局部结构等价替换 |
| Canonicalization | 收敛到统一、简化的表示 |
| Dialect Conversion | 依据合法性目标完成受约束的跨 Dialect/Type 转换 |
| Lowering | 更宽泛的过程：逐步把抽象语义具体化，内部可使用 Rewrite、Conversion 和 Pass |

不是每次 Lowering 都必须更接近机器。例如把一个自定义图 Dialect 降到 `linalg` 是
Lowering，把 `linalg` 分块后仍保持在同一 Dialect 也可能是 Lowering 管线的一部分。

# 10. Bufferization：从值语义到内存语义

Tensor 和 MemRef 都带 Shape，但表达的所有权与可变性不同：

| `tensor` | `memref` |
|---|---|
| 数学值语义 | 对物理 Buffer 的引用语义 |
| SSA 结果表示新的逻辑值 | 写操作可以改变所引用内存 |
| 便于做融合、重排和代数变换 | 需要处理别名、分配、释放和布局 |
| 不直接承诺存储位置 | 显式表达 address space、offset、size、stride |

Bufferization 不是把文本中的 `tensor` 替换成 `memref`。它必须决定每个 Tensor Result
落在哪个 Buffer、是否能复用已有 Buffer、何时需要复制，以及跨函数边界如何传递。

## 10.1 为什么尽量晚做 Bufferization

在 Tensor 层，两个 SSA Value 的逻辑内容关系清晰，许多 Tiling、Fusion 和 Shape
变换不必同时处理别名。过早进入 MemRef 层会引入读写顺序和别名约束，使原本合法的
算子重排需要更复杂证明。因此常见策略是先在 Tensor 层完成主要结构变换，再在进入
低层内存和代码生成前 Bufferize。

## 10.2 Destination-Passing Style

Destination-Passing Style（DPS）让 Operation 显式接收结果目的地，例如
`linalg.matmul` 的 `outs`。这给 Bufferization 提供潜在复用对象：如果分析证明目的
Buffer 与其他活跃 Value 不冲突，就可以原地写入；否则必须分配或复制。

判断能否原地复用通常依赖：

- Tensor SSA 的读写关系；
- Extract/Insert Slice 形成的别名；
- Value 是否在写入后仍需保留旧内容；
- Operation 是否实现 `BufferizableOpInterface`；
- 函数边界和递归调用限制。

One-Shot Bufferize 会在较大范围内分析这些 use-def 关系。它依赖 Operation 实现
`BufferizableOpInterface` 来回答：哪些 Operand 会读写、Result 与哪个 Operand
别名，以及该 Operation 怎样改写成 Buffer 形式。没有接口的 Operation 不能仅凭名称
猜测内存效果。

## 10.3 为什么有时必须复制

下面的 `%updated` 和 `%tensor` 在 Tensor SSA 语义中是两个逻辑值：

```mlir
func.func @update_then_read_old(
    %tensor: tensor<?xf32>, %value: f32, %i: index, %j: index)
    -> (tensor<?xf32>, f32) {
  %updated = tensor.insert %value into %tensor[%i] : tensor<?xf32>
  %old = tensor.extract %tensor[%j] : tensor<?xf32>
  func.return %updated, %old : tensor<?xf32>, f32
}
```

若 `%updated` 直接原地复用 `%tensor` 的 Buffer，后面的 `%old` 在 `%i == %j` 时会读到
新值，破坏“读取旧 SSA Value”的语义。这是典型的 Read-after-Write 冲突，Bufferization
必须换用其他 Buffer 或插入 Copy。若旧值在写入后不再使用，且别名分析也没有发现
冲突，同一次 `tensor.insert` 才可能安全地原地执行。

从外部 MemRef 进入 Tensor 世界时，边界声明也会影响分析：

- `bufferization.to_tensor ... restrict` 承诺没有其他 `to_tensor` 或
  `materialize_in_destination` 以别名方式把同一底层 Buffer 暴露给 Tensor IR，使
  One-Shot Analysis 能建立可靠的别名入口；
- `writable` 承诺底层 Buffer 可写，否则 Tensor 结果不能原地写回；
- `bufferization.alloc_tensor` 可以显式要求一块新的 Tensor Buffer，常用于切断别名；
- 错误添加 `restrict` 或 `writable` 是前端违反契约，不是一次普通的优化失误。

## 10.4 一次实际的 One-Shot Bufferize

下面的逐元素加法先创建结果 Tensor，再用它作为 `outs`：

```mlir
#identity = affine_map<(i) -> (i)>

func.func @add(%lhs: tensor<?xf32>, %rhs: tensor<?xf32>)
    -> tensor<?xf32> {
  %c0 = arith.constant 0 : index
  %n = tensor.dim %lhs, %c0 : tensor<?xf32>
  %init = tensor.empty(%n) : tensor<?xf32>
  %result = linalg.generic {
      indexing_maps = [#identity, #identity, #identity],
      iterator_types = ["parallel"]
    }
    ins(%lhs, %rhs : tensor<?xf32>, tensor<?xf32>)
    outs(%init : tensor<?xf32>) {
  ^bb0(%x: f32, %y: f32, %unused: f32):
    %sum = arith.addf %x, %y : f32
    linalg.yield %sum : f32
  } -> tensor<?xf32>
  func.return %result : tensor<?xf32>
}
```

对这段 IR 运行：

```bash
mlir-opt add.mlir \
  --one-shot-bufferize='bufferize-function-boundaries function-boundary-type-conversion=identity-layout-map'
```

核心结果变为：

```mlir
func.func @add(%lhs: memref<?xf32>, %rhs: memref<?xf32>)
    -> memref<?xf32> {
  %c0 = arith.constant 0 : index
  %n = memref.dim %lhs, %c0 : memref<?xf32>
  %buffer = memref.alloc(%n) {alignment = 64 : i64} : memref<?xf32>
  linalg.generic
      {indexing_maps = [#identity, #identity, #identity],
       iterator_types = ["parallel"]}
      ins(%lhs, %rhs : memref<?xf32>, memref<?xf32>)
      outs(%buffer : memref<?xf32>) {
  ^bb0(%x: f32, %y: f32, %unused: f32):
    %sum = arith.addf %x, %y : f32
    linalg.yield %sum : f32
  }
  func.return %buffer : memref<?xf32>
}
```

`tensor.empty` 变成 Allocation，Tensor 函数边界变成 MemRef，Linalg 的标量计算不变。
此时仍保留 `linalg.generic`，说明 Bufferization 只决定存储，并不负责把所有结构化算子
展开成循环。

`bufferize-function-boundaries` 仍要求项目明确函数 ABI、递归和外部调用的策略。若
Pipeline 允许未知 Operation，`allow-unknown-ops` 会在边界插入 `to_buffer` /
`to_tensor` 桥接；这适合分阶段迁移，不代表未知 Operation 已经正确 Bufferize。

## 10.5 Allocation、Deallocation 与 MemRef Descriptor

One-Shot Bufferize 解决“Tensor 映射到哪块 Buffer”，不自动等价于完整的所有权系统。
上例返回新分配的 MemRef，Allocation 已逃逸到调用方；谁释放它必须由函数 ABI 或运行时
约定决定。对于没有逃逸的分配，可以继续运行 `buffer-deallocation-pipeline` 插入并
简化释放逻辑，也可以在证明尺寸足够小且生命周期合适后提升到栈上。

动态 MemRef 降低到 LLVM Dialect 时通常需要 descriptor 来携带：

```text
allocated pointer
aligned pointer
offset
sizes[rank]
strides[rank]
```

所以 `memref<?x128xf32>` 不能简单当作一个 `float *`。同一个底层 Allocation 可以通过
Subview 形成具有不同 offset、size 和 stride 的 MemRef；地址计算必须使用这些布局
元数据。`memref` 的 Memory Space 还会在 GPU 路径中区分 global、workgroup、private
等存储区域，不能在 Lowering 时随意丢弃。

# 11. CPU 与 GPU 的典型 Lowering 路径

CPU 和 GPU 不只是最后换一个后端。两条路径可以共享 Tensor、Shape、Linalg 和一部分
Vector 变换，但一旦确定并行层级、Memory Space、同步方式与调用 ABI，IR 契约就明显
不同。

## 11.1 分流前要完成什么

在仍保留结构化算子时，编译器通常先处理：

- Shape Specialization、广播和动态边界 Guard；
- Producer/Consumer Fusion，减少中间 Tensor；
- 按 Cache、共享内存或向量宽度选择 Tile；
- Layout Propagation、Pack/Unpack 和数据类型转换；
- 决定调用外部库，还是生成自己的循环或 Kernel。

这些决策并非必须全部早于分流。例如 GPU Tile Size 依赖具体设备，CPU Vector Width
依赖目标特性；通用 Pipeline 可以保留参数化结构，到目标相关阶段再完成选择。

## 11.2 CPU 路径

CPU 路径围绕缓存层级、SIMD、线程并行和平台 ABI 逐步具体化：

```mermaid
flowchart LR
    LINALG["Tensor / Linalg"] --> SCHEDULE["Tile · Fuse · Pack"]
    SCHEDULE --> VECTOR["Vector<br/>contract · transfer · reduction"]
    VECTOR --> BUFFER["One-Shot Bufferize<br/>Tensor → MemRef"]
    BUFFER --> LOOPS["SCF / Affine → CF<br/>循环与分支"]
    LOOPS --> LLVM_D["LLVM Dialect<br/>指针、函数与整数运算"]
    LLVM_D --> LLVM_IR["LLVM IR"]
    LLVM_IR --> CPU["LLVM CPU Backend<br/>目标文件"]
```

实际顺序可以交错：有的 Vectorization 在 Tensor/Linalg 上完成，有的在 MemRef 上完成；
Linalg 也可以先 Lower 到 SCF/Affine，再做循环变换。无论选择哪条路线，进入 LLVM
Dialect 前通常需要分别处理这些残留：

| 残留语义 | 常见出口 |
|---|---|
| `linalg` | Lower 为循环、Vector，或替换成库调用 |
| `scf` / `affine` | 降到 `cf` 和算术地址计算 |
| `vector` | 降到 LLVM Vector、Intrinsic 或标量序列 |
| `memref` | 展开为指针、Descriptor、Size 和 Stride |
| `func`、`arith`、`cf` | 转成 LLVM Dialect 对应 Operation |
| `unrealized_conversion_cast` | 协调类型边界后消除 |

LLVM Dialect 仍不是机器码。`mlir-translate --mlir-to-llvmir` 只完成到 LLVM IR 的翻译，
之后才由 LLVM 的优化、指令选择、寄存器分配和汇编流程生成 CPU 目标文件。

## 11.3 GPU 路径的 Host 与 Device

GPU 程序至少有两部分：Host 负责准备参数、选择设备并发射 Kernel；Device Kernel 才在
GPU 线程层级中执行。只画 Device 侧 Lowering 会遗漏一半流程：

```mermaid
flowchart TD
    PAYLOAD["Tensor / Linalg"] --> MAP["Tile，并映射到<br/>grid · block · warp · thread"]
    MAP --> LAUNCH["gpu.launch<br/>内联 Kernel Region"]
    LAUNCH --> OUTLINE["Kernel Outlining"]
    OUTLINE --> HOST["Host IR<br/>gpu.launch_func + 参数与依赖"]
    OUTLINE --> DEVICE["gpu.module / gpu.func<br/>Device IR"]
    DEVICE --> SPECIAL["Vector / NVGPU / AMDGPU<br/>MMA、async copy"]
    SPECIAL --> TARGET["NVVM · ROCDL · SPIR-V"]
    TARGET --> BINARY["PTX / CUBIN / HSACO / SPIR-V"]
    HOST --> RUNTIME["Host Lowering<br/>GPU Runtime 调用"]
    BINARY --> PACKAGE["嵌入或外置 Device Binary"]
    RUNTIME --> LINK["Host Object / Executable"]
    PACKAGE --> LINK
```

`gpu.launch` 拥有一个内联 Region，适合映射和变换；Outlining 后，Kernel 通常成为
`gpu.module` 中的 `gpu.func`，Host 侧改用符号引用形式的 `gpu.launch_func`。二者不是
重复表示，而是 Kernel 分离前后的两个阶段。

`gpu.module` 也不是普通 Host Module。它描述一个 Device 编译单元，可以附带目标属性，
再由 `gpu-module-to-binary` 调用相应序列化流程生成一个或多个目标对象。生成 Device
Binary 后，还需要决定怎样嵌入 Host Object、何时加载以及通过哪种 Runtime 发射。

## 11.4 线程、地址空间和同步怎样落地

| 决策 | IR 中需要明确的内容 | 错误后果 |
|---|---|---|
| 线程映射 | 每个 Tile 对应哪个 Block/Thread，边界是否 Predicate | 漏算、重复计算或越界 |
| Memory Promotion | global、workgroup/shared、private 等 Memory Space | 非法地址转换或性能急剧下降 |
| 跨线程依赖 | `gpu.barrier`、async token、wait 的覆盖范围 | 数据竞争和读取未完成数据 |
| 归约 | warp/subgroup 通信、原子操作或分层归约 | 非确定结果或严重串行化 |
| MMA | Tile Shape、dtype、Layout 与目标指令约束 | Pattern 不匹配或结果布局错误 |
| Kernel ABI | 参数、MemRef Descriptor、Address Space 与对齐 | Host/Device 参数解释不一致 |

GPU Dialect 提供目标相对中立的 Launch、ID、Barrier 和 Address Space；NVGPU/AMDGPU
保留厂商相关的 MMA、异步拷贝等能力；NVVM/ROCDL 已接近相应 LLVM Intrinsic；SPIR-V
Dialect 面向 SPIR-V 生态。它们不是相互排斥的同层格式，而是可以连续出现的抽象层级。

当前 MLIR 提供 `--gpu-lower-to-nvvm-pipeline` 作为一条默认 NVIDIA 路径，也提供
`--convert-gpu-to-nvvm`、`--convert-gpu-to-rocdl`、目标附加和
`--gpu-module-to-binary` 等组成 Pass。默认 Pipeline 仍要求输入已经满足支持的
GPU/SCF/Vector 子集，并且系统中存在对应的目标工具链；它不会替前端完成正确的 Tiling、
线程映射和同步设计。

## 11.5 为什么不存在万能 Lowering Pipeline

同一 `matmul` 在不同 Shape、dtype 和硬件上可能选择：

- 小矩阵直接生成普通循环；
- CPU 上分块并向量化；
- GPU 上使用 shared memory 与 SIMT；
- 映射到 MMA/Tensor Core；
- 调用经过调优的外部库；
- 保留动态 Shape 的通用 Kernel，或生成多个受 Guard 保护的版本。

合法性回答“这种变换是否保持语义”，成本模型回答“在当前目标上是否值得”。MLIR
提供表达与变换基础设施，但 Schedule、成本模型、运行时契约和目标能力仍由具体编译器
定义。

CFG、数据流、Tiling、GPU 映射和性能归因背后的算法见
[编译器与高性能系统算法](post.html?slug=compiler_algorithms)。

# 12. Transform Dialect：把变换顺序也表示成 IR

普通 Pass Pipeline 通常在 C++ 或命令行中固定变换顺序。高性能算子往往需要更细粒度
控制：只匹配某几个 `linalg.matmul`，先按指定尺寸 Tiling，再对产生的内层循环做
Unroll，并把某些数据提升到快速内存。

Transform Dialect 把这种调度写成另一份 IR：

- **Payload IR**：真正要被优化的程序；
- **Transform IR**：匹配 Payload 中的 Operation/Value，并描述要执行的变换；
- **Handle**：Transform IR 中指向一组 Payload Operation 或 Value 的 SSA Value；
- **Parameter**：变换执行时使用的整数、属性等配置。

```mermaid
flowchart LR
    TRANSFORM["Transform IR<br/>match → tile → fuse → vectorize"] --> ENGINE["Transform Interpreter"]
    PAYLOAD["Payload IR<br/>linalg.matmul · loops"] --> ENGINE
    ENGINE --> RESULT["变换后的 Payload IR"]
```

Transform Dialect 不取代 Pass 和 Pattern 基础设施。它负责精确选择对象并编排顺序，
底层动作仍可以由现有 C++ Pass、RewritePattern 或 Interface 实现。

Handle 不拥有 Payload Operation。某次变换删除或替换了 Operation 后，旧 Handle 可能
失效；继续使用无效 Handle 会被 Transform Dialect 的副作用与验证机制拒绝。理解这一
点可以避免把 Handle 错当成长期稳定的裸指针。

# 13. Symbol、隔离与并行 Pass

`builtin.module` 和 `func.func` 等 Operation 可以定义符号或符号表。调用通常使用
`SymbolRefAttr` 引用函数名，而不是普通 SSA Value；符号解析沿嵌套 SymbolTable 进行。
重命名或删除符号时应使用符号表工具同步更新引用。

许多顶层容器具有 `IsolatedFromAbove` Trait，表示其内部不能隐式捕获外部 SSA Value。
这种边界让 Pass Manager 可以更安全地缓存 Analysis，并在不同函数或模块片段间并行
执行 Pass。它不是 C++ 访问控制，而是 IR 可见性和变换隔离契约。

# 14. 构建与使用 MLIR 工具

MLIR 位于 `llvm-project/mlir`。下面构建常用工具和示例：

```bash
git clone https://github.com/llvm/llvm-project.git
cd llvm-project

cmake -G Ninja -S llvm -B build \
  -DLLVM_ENABLE_PROJECTS=mlir \
  -DLLVM_BUILD_EXAMPLES=ON \
  -DLLVM_TARGETS_TO_BUILD='Native;NVPTX;AMDGPU' \
  -DCMAKE_BUILD_TYPE=Release

cmake --build build --target mlir-opt mlir-translate llc
```

只研究 CPU 路径时可以缩减 `LLVM_TARGETS_TO_BUILD`。开发上游 MLIR 时通常使用带
Assertions 的构建，以便更早暴露 IR 不变量和 API 使用错误。

## 14.1 `mlir-opt`

`mlir-opt` 负责解析 MLIR、运行 Pass Pipeline 并打印结果：

```bash
# 解析、验证并重新打印
build/bin/mlir-opt input.mlir

# 在函数层运行规范化和 CSE
build/bin/mlir-opt input.mlir \
  --pass-pipeline='builtin.module(func.func(canonicalize,cse))'

# 强制使用通用 Operation 语法打印
build/bin/mlir-opt input.mlir --mlir-print-op-generic
```

如果输入包含未注册的自定义 Dialect，`--allow-unregistered-dialect` 只能让 parser 把
未知 Operation 当作通用 Operation 接收；它不会提供 verifier、Interface、Pattern 或
Lowering 语义。真正运行项目 Pass 时仍应注册 Dialect。

## 14.2 观察每个 Pass 的 IR

```bash
build/bin/mlir-opt input.mlir \
  --pass-pipeline='builtin.module(func.func(canonicalize,cse))' \
  --mlir-disable-threading \
  --mlir-print-ir-before-all \
  --mlir-print-ir-after-all
```

关闭多线程能让嵌套 Pass 的调试输出更容易按顺序阅读。输出太大时，可只打印指定 Pass
前后，或使用 IR printing 的过滤选项。定位问题时应找到“最后一个正确 IR”和“第一个
错误 IR”，再检查该 Pass 的输入契约和新建 Operation。

## 14.3 从 LLVM Dialect 到 LLVM IR

只有当 Module 已满足 LLVM translation 的要求时，才能执行：

```bash
build/bin/mlir-translate lowered.mlir --mlir-to-llvmir > output.ll
build/bin/llc output.ll -filetype=obj -o output.o
```

如果还残留 `linalg`、`scf`、`memref` 或未处理的转换桥接 Operation，问题通常不在
`mlir-translate`，而在前面的 Conversion Target 或 Pipeline 缺少必要 Lowering。

## 14.4 一个可编译的最小 Dialect 工程

下面不是只供阅读的 ODS 片段，而是一套在 LLVM/MLIR 22 上实际完成 TableGen、C++
编译、Dialect Conversion、LLVM IR 翻译和本机执行的独立工程。为了让关键依赖集中可见，
文件采用扁平布局；大型项目再拆成 `include/`、`lib/`、`tools/` 和 `test/`。

```text
mini-mlir/
├── CMakeLists.txt
├── MiniOps.td
├── MiniDialect.h
├── MiniDialect.cpp
├── mini-opt.cpp
└── add.mlir
```

`CMakeLists.txt` 通过安装目录中的 `MLIRConfig.cmake` 使用 MLIR，不要求把工程放进
`llvm-project` 源码树：

```cmake
cmake_minimum_required(VERSION 3.20)
project(mini-mlir LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17 CACHE STRING "C++ standard")
set(CMAKE_CXX_STANDARD_REQUIRED ON)
find_package(MLIR REQUIRED CONFIG)

set(LLVM_RUNTIME_OUTPUT_INTDIR ${CMAKE_BINARY_DIR}/bin)
set(LLVM_LIBRARY_OUTPUT_INTDIR ${CMAKE_BINARY_DIR}/lib)
set(MLIR_BINARY_DIR ${CMAKE_BINARY_DIR})
list(APPEND CMAKE_MODULE_PATH "${MLIR_CMAKE_DIR}" "${LLVM_CMAKE_DIR}")
include(TableGen)
include(AddLLVM)
include(AddMLIR)
include(HandleLLVMOptions)

include_directories(${LLVM_INCLUDE_DIRS} ${MLIR_INCLUDE_DIRS})
include_directories(${PROJECT_SOURCE_DIR} ${PROJECT_BINARY_DIR})
link_directories(${LLVM_BUILD_LIBRARY_DIR})
add_definitions(${LLVM_DEFINITIONS})

add_mlir_dialect(MiniOps mini)

add_mlir_dialect_library(MiniDialect
  PARTIAL_SOURCES_INTENDED
  MiniDialect.cpp
  DEPENDS MLIRMiniOpsIncGen
  LINK_LIBS PUBLIC
    MLIRIR
    MLIRInferTypeOpInterface
    MLIRSideEffectInterfaces
)

add_llvm_executable(mini-opt
  PARTIAL_SOURCES_INTENDED
  mini-opt.cpp
)
llvm_update_compile_flags(mini-opt)
target_link_libraries(mini-opt PRIVATE
  MiniDialect
  MLIRArithDialect
  MLIRArithToLLVM
  MLIRFuncDialect
  MLIRFuncToLLVM
  MLIRLLVMDialect
  MLIROptLib
  MLIRReconcileUnrealizedCasts
  MLIRTransforms
)
mlir_check_all_link_libraries(mini-opt)
```

`add_mlir_dialect` 会从 `MiniOps.td` 生成 Operation、Type 和 Dialect 的 `.inc` 文件，
`MLIRMiniOpsIncGen` 保证 C++ 编译发生在生成之后。这里没有注册所有内置 Dialect 和 Pass，
而是只链接并注册闭环实际使用的部分，依赖关系更容易检查。

`MiniOps.td` 定义 Dialect 和唯一的 Operation：

```tablegen
#ifndef MINI_OPS
#define MINI_OPS

include "mlir/IR/OpBase.td"
include "mlir/Interfaces/InferTypeOpInterface.td"
include "mlir/Interfaces/SideEffectInterfaces.td"

def Mini_Dialect : Dialect {
  let name = "mini";
  let cppNamespace = "::mini";
}

class Mini_Op<string mnemonic, list<Trait> traits = []>
    : Op<Mini_Dialect, mnemonic, traits>;

def Mini_AddOp : Mini_Op<"add", [Pure, SameOperandsAndResultType]> {
  let summary = "add two i32 values";
  let arguments = (ins I32:$lhs, I32:$rhs);
  let results = (outs I32:$result);
  let assemblyFormat = "$lhs `,` $rhs attr-dict `:` type($result)";
}

#endif
```

`MiniDialect.h` 引入生成的 Dialect 声明和类型化 Op wrapper：

```cpp
#ifndef MINI_MINIDIALECT_H
#define MINI_MINIDIALECT_H

#include "mlir/IR/Dialect.h"
#include "mlir/IR/OpDefinition.h"
#include "mlir/Interfaces/InferTypeOpInterface.h"
#include "mlir/Interfaces/SideEffectInterfaces.h"

#include "MiniOpsDialect.h.inc"

#define GET_OP_CLASSES
#include "MiniOps.h.inc"

#endif
```

`MiniDialect.cpp` 注册生成的 Operation，并包含 parser/printer 定义所需的完整接口：

```cpp
#include "MiniDialect.h"
#include "mlir/IR/OpImplementation.h"

using namespace mlir;
using namespace mini;

#include "MiniOpsDialect.cpp.inc"

void MiniDialect::initialize() {
  addOperations<
#define GET_OP_LIST
#include "MiniOps.cpp.inc"
      >();
}

#define GET_OP_CLASSES
#include "MiniOps.cpp.inc"
```

`mini-opt.cpp` 同时提供工具入口和一个 Module Pass。该 Pass 把整个 Mini Dialect 标成
非法，把每个 `mini.add` 转换成 `arith.addi`；如果将来增加了 Mini Operation 却没有
Lowering Pattern，Conversion 会失败，而不是把未知语义带入后端：

```cpp
#include "MiniDialect.h"

#include "mlir/Conversion/Passes.h"
#include "mlir/Dialect/Arith/IR/Arith.h"
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include "mlir/Dialect/LLVMIR/LLVMDialect.h"
#include "mlir/IR/BuiltinOps.h"
#include "mlir/Pass/Pass.h"
#include "mlir/Pass/PassRegistry.h"
#include "mlir/Transforms/DialectConversion.h"
#include "mlir/Tools/mlir-opt/MlirOptMain.h"

#include <utility>

namespace {

class LowerMiniAdd final : public mlir::OpConversionPattern<mini::AddOp> {
public:
  using OpConversionPattern::OpConversionPattern;

  mlir::LogicalResult matchAndRewrite(
      mini::AddOp op, OpAdaptor adaptor,
      mlir::ConversionPatternRewriter &rewriter) const override {
    rewriter.replaceOpWithNewOp<mlir::arith::AddIOp>(
        op, adaptor.getLhs(), adaptor.getRhs());
    return mlir::success();
  }
};

class LowerMiniToArithPass final
    : public mlir::PassWrapper<LowerMiniToArithPass,
                               mlir::OperationPass<mlir::ModuleOp>> {
public:
  MLIR_DEFINE_EXPLICIT_INTERNAL_INLINE_TYPE_ID(LowerMiniToArithPass)

  llvm::StringRef getArgument() const final {
    return "lower-mini-to-arith";
  }
  llvm::StringRef getDescription() const final {
    return "Lower the Mini dialect to Arith";
  }
  void getDependentDialects(mlir::DialectRegistry &registry) const override {
    registry.insert<mlir::arith::ArithDialect>();
  }

  void runOnOperation() override {
    mlir::ConversionTarget target(getContext());
    target.addIllegalDialect<mini::MiniDialect>();
    target.addLegalDialect<mlir::arith::ArithDialect>();
    target.markUnknownOpDynamicallyLegal(
        [](mlir::Operation *) { return true; });

    mlir::RewritePatternSet patterns(&getContext());
    patterns.add<LowerMiniAdd>(&getContext());
    if (mlir::failed(mlir::applyPartialConversion(
            getOperation(), target, std::move(patterns))))
      signalPassFailure();
  }
};

static mlir::PassRegistration<LowerMiniToArithPass> registerLowerMiniPass;

} // namespace

int main(int argc, char **argv) {
  mlir::registerArithToLLVMConversionPass();
  mlir::registerConvertFuncToLLVMPass();
  mlir::registerReconcileUnrealizedCastsPass();

  mlir::DialectRegistry registry;
  registry.insert<mini::MiniDialect, mlir::arith::ArithDialect,
                  mlir::func::FuncDialect, mlir::LLVM::LLVMDialect>();
  return mlir::asMainReturnCode(
      mlir::MlirOptMain(argc, argv, "Mini optimizer\n", registry));
}
```

输入 `add.mlir` 只做一件可观察的事：让 `main` 返回 42。

```mlir
module {
  func.func @main() -> i32 {
    %lhs = arith.constant 40 : i32
    %rhs = arith.constant 2 : i32
    %sum = mini.add %lhs, %rhs : i32
    func.return %sum : i32
  }
}
```

先配置并编译。`MLIR_DIR` 必须指向与当前头文件、静态库和编译选项完全匹配的
`lib/cmake/mlir`：

```bash
cmake -G Ninja -S . -B build \
  -DMLIR_DIR=/path/to/llvm-install/lib/cmake/mlir \
  -DCMAKE_BUILD_TYPE=Release
cmake --build build --target mini-opt
```

如果链接器报告 `typeinfo for mlir::Pass` 等错误，通常是工程的 RTTI/异常选项与所链接
MLIR 不一致。应使用同一 Build/Install Tree，并让 `LLVMConfig.cmake` 和
`HandleLLVMOptions` 传播一致选项；不要混用另一份 LLVM 头文件或静态库。

只运行自定义 Pass，可以直接看到阶段出口：

```bash
build/bin/mini-opt add.mlir \
  --lower-mini-to-arith -o arith.mlir
```

```mlir
module {
  func.func @main() -> i32 {
    %c40_i32 = arith.constant 40 : i32
    %c2_i32 = arith.constant 2 : i32
    %0 = arith.addi %c40_i32, %c2_i32 : i32
    func.return %0 : i32
  }
}
```

再运行已注册的标准 Conversion，把 `arith` 和 `func` 全部降到 LLVM Dialect：

```bash
build/bin/mini-opt add.mlir \
  --lower-mini-to-arith \
  --convert-arith-to-llvm \
  --convert-func-to-llvm \
  --reconcile-unrealized-casts \
  -o lowered.mlir
```

本例的常量加法在转换中被折叠，核心输出是：

```mlir
module {
  llvm.func @main() -> i32 {
    %0 = llvm.mlir.constant(40 : i32) : i32
    %1 = llvm.mlir.constant(2 : i32) : i32
    %2 = llvm.mlir.constant(42 : i32) : i32
    llvm.return %2 : i32
  }
}
```

最后翻译、编译并执行：

```bash
/path/to/llvm-install/bin/mlir-translate lowered.mlir \
  --mlir-to-llvmir -o output.ll
/path/to/llvm-install/bin/clang output.ll -o mini-example

./mini-example
printf 'exit=%d\n' "$?"
# exit=42
```

退出码 42 是输入程序刻意定义的返回值。至此形成了可重复检查的闭环：

```text
MiniOps.td
→ TableGen 生成 C++ 接口
→ mini-opt 解析 mini.add
→ 自定义 Conversion：Mini → Arith
→ 标准 Conversion：Arith/Func → LLVM Dialect
→ mlir-translate：LLVM Dialect → LLVM IR
→ clang：LLVM IR → 本机可执行文件
→ 运行结果 = 42
```

这套工程为了最小化只实现 `mini.add`。真正扩展时，应把 Dialect、Conversion、工具和
测试拆成独立 Target，并为每个阶段分别添加 parser/verifier、Conversion 残留检查、
`lit`/`FileCheck` 与端到端执行测试。

# 15. 测试与调试

## 15.1 Verifier 放在每个阶段边界

Verifier 能检查 Operand/Result Type、Region 数量、terminator、Trait 和自定义约束。
开发转换时应在关键 Pass 后验证 IR，而不是等最终 CodeGen 才发现结构损坏。

常见错误包括：

- 替换 Operation 后留下悬空使用；
- 新 Result Type 与使用者期望不一致；
- Region 缺少 terminator；
- Block Argument 与前驱传参不匹配；
- Conversion 结束后仍残留非法 Dialect；
- 修改了 IR 却错误保留旧 Analysis；
- 创建 Operation 时丢失 Location。

## 15.2 `lit` 与 `FileCheck`

MLIR 回归测试通常把运行命令和检查模式放在 `.mlir` 文件中：

```mlir
// RUN: mlir-opt %s --canonicalize | FileCheck %s

func.func @add_zero(%arg0: i32) -> i32 {
  %c0 = arith.constant 0 : i32
  %sum = arith.addi %arg0, %c0 : i32
  func.return %sum : i32
}

// CHECK-LABEL: func.func @add_zero
// CHECK-NOT: arith.addi
// CHECK: func.return %arg0
```

检查重点应是转换契约，而不是复制整个打印结果。过度依赖临时 SSA 名称、无关
Attribute 顺序或完整 Module 文本，会让等价的 printer 变化造成大量脆弱测试。

## 15.3 分层判断错误来源

```text
Parser 失败
→ 检查 Dialect 注册、语法和 Type/Attribute 拼写

Verifier 失败
→ 检查 Operation/Region 契约和类型关系

Pattern 不匹配
→ 打开 Pattern debug，检查 root、动态条件和 benefit

Conversion 失败
→ 查找残留非法 Operation、Type 与 materialization

翻译 LLVM IR 失败
→ 检查是否完整 Lowering 到 LLVM Dialect 可翻译子集

运行结果错误
→ 比较每个阶段语义，重点检查别名、边界、同步和未定义行为

性能退化
→ 检查 tile、layout、复制、寄存器、缓存、occupancy 与 launch 数量
```

语法合法不等于语义正确，语义正确也不等于性能合理。Verifier、差分执行和性能计数器
分别覆盖不同层次，不能互相替代。

# 16. 设计自定义 Dialect 的顺序

## 16.1 先确定要保留的语义

如果一个 Operation 只把现有低层指令换了名字，却没有保存额外结构，它只会增加
Lowering 维护成本。自定义 Dialect 更适合承载标准 Dialect 暂时不能准确表达的信息，
例如领域算子约束、特殊布局、设备资源或运行时协议。

定义每个 Operation 前先写清：

- Operand、Result、Attribute、Property 和 Region 分别是什么；
- 动态 Shape 如何表达；
- 是否有副作用、别名或资源读写；
- 哪些关系能静态验证；
- 哪些 Interface 可供通用变换使用；
- Canonical form 是什么；
- 最终降低到哪些 Dialect；
- 失败时怎样给出可定位诊断。

## 16.2 再确定 Lowering 边界

一个清晰的阶段边界应能用 Conversion Target 描述。例如：

```text
输入：允许 toy + tensor + linalg + arith + func
输出：禁止 toy，允许 linalg + tensor + arith + func
```

这样测试可以直接断言 Toy Dialect 已全部消失。若边界只写成“运行 LowerToyPass”，却
没有描述输出合法集合，后续 Pass 会逐渐依赖偶然残留的混合 IR。

## 16.3 最后补齐可组合能力

按实际需要实现：

- parser/printer 和 bytecode 支持；
- verifier、fold 和 canonicalization；
- shape/type inference；
- side-effect、tiling、bufferization 等 Interface；
- Dialect Conversion 和 TypeConverter；
- Pass Pipeline 及命令行注册；
- 单元测试、IR 回归测试和端到端执行测试。

“能打印一个自定义 Operation”只是起点。能被分析、重写、Bufferize、Lowering 和诊断，
才说明它真正接入了编译器生态。

# 17. 容易混淆的概念

## 17.1 MLIR 是不是 LLVM IR 的新版语法

不是。MLIR 是可扩展的多层 IR 框架；LLVM IR 是相对固定的低层 IR。MLIR 的 LLVM
Dialect 只是二者之间的衔接层之一。

## 17.2 Dialect 是不是彼此隔离的文件格式

不是。多个 Dialect 可以共存于同一个 Module，Value 也可以跨 Dialect Operation
连接，只要类型和语义契约允许。Dialect 提供命名空间与扩展边界，不代表每种 Dialect
必须单独存储。

## 17.3 Region 是不是 BasicBlock

不是。Region 容纳 Block，并由父 Operation 定义语义；Block 才是 Operation 的线性
序列。某些 Region 是 CFG，某些 Region 是图或其他结构。

## 17.4 `tensor` 和 `memref` 是否只差一个名字

不是。Tensor 是值语义，MemRef 是可别名的 Buffer 引用语义。二者转换需要处理原地
复用、复制、布局、分配和释放。

## 17.5 Pattern 是否等于 Pass

不是。Pattern 描述局部匹配和改写；Pass 决定在哪个 IR 层级、以什么顺序和配置运行
Pattern 或其他算法。一个 Pass 可以运行很多 Pattern，一个 Pattern 也可被不同 driver
复用。

## 17.6 Conversion 成功是否代表已经生成机器码

不是。Conversion 只保证当前 `ConversionTarget` 的合法性。高层 Dialect 到 Linalg、
Linalg 到循环、循环到 LLVM Dialect 都可以分别完成一次成功 Conversion，但离目标代码
仍有不同距离。

## 17.7 Generic form 是否比 custom form 更低层

不是。它们只是同一 Operation 的两种文本表示。Generic form 暴露统一字段，custom
form 更易读；抽象层级由 Operation 语义决定。

## 17.8 Canonicalization 是否一定提升性能

不一定。Canonicalization 主要把 IR 变得统一、消除显然冗余并为后续 Pass 创造稳定
输入。最终性能取决于后续 Tiling、Vectorization、Memory Planning、CodeGen 和硬件。
