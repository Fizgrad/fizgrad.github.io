# Compiler lab

博客中的可运行示例，面向 Linux/ELF 与 LLVM、Clang、MLIR 22 的兼容安装。
构建目录放在仓库外，不需要改动编译器源码或安装系统组件。

| 目录 | 示例 |
|---|---|
| `llvm-pass` | MulToShift New PM 插件、全局变量与模块构造函数生成工具 |
| `clang-tools` | AST Matchers 诊断/Fix-It 工具、路径敏感文件资源 Checker |
| `pointer` | 有限抽象对象上的包含式指向集合求解器 |
| `mlir-effects` | 自定义内存效果接口及 Canonicalizer/CSE 行为 |
| `validation` | LoopSimplify/LCSSA、别名检查、除法反例、RAII 与 ARM64 CFI |
| `linking` | ELF 归档、共享库、符号覆盖、COMDAT 与重定位 |

## 一次运行全部检查

需要 Node.js、CMake、Ninja，以及含开发头文件、CMake 配置和库的完整 LLVM/Clang/MLIR
安装。只有几个编译器可执行文件不够构建这些工具。

```bash
node tools/compiler-lab/check.mjs --prefix /path/to/llvm-install
```

默认创建 `/tmp/compiler-lab-*`，结束时打印生成物路径，便于继续查看 IR、汇编、插件和
ELF 文件。重复开发可使用 `--build-dir /tmp/compiler-lab-work` 复用构建目录。

`FileCheck` 不在安装的 `bin` 中时可以传入 `--filecheck /path/to/FileCheck`。未提供可用
FileCheck 时仍会运行 Verifier、IR 断言、Clang `-verify` 和执行测试，但会明确跳过该项。

可选的 `--alive-tv /path/to/alive-tv` 会额外检查有符号除法候选。没有该参数时，测试
只运行已定义输入上的具体反例与回归，不宣称执行了 Alive2。Alive2 必须能够理解当前
LLVM IR；不支持、超时和 Unknown 不能作为验证成功。

## 单独构建

```bash
cmake -S tools/compiler-lab/llvm-pass -B /tmp/llvm-pass-lab -G Ninja \
  -DLLVM_DIR=/path/to/llvm-install/lib/cmake/llvm \
  -DCMAKE_CXX_COMPILER=/path/to/llvm-install/bin/clang++
cmake --build /tmp/llvm-pass-lab

cmake -S tools/compiler-lab/clang-tools -B /tmp/clang-lab -G Ninja \
  -DLLVM_DIR=/path/to/llvm-install/lib/cmake/llvm \
  -DClang_DIR=/path/to/llvm-install/lib/cmake/clang \
  -DCMAKE_CXX_COMPILER=/path/to/llvm-install/bin/clang++
cmake --build /tmp/clang-lab

cmake -S tools/compiler-lab/mlir-effects -B /tmp/mlir-effects-lab -G Ninja \
  -DMLIR_DIR=/path/to/llvm-install/lib/cmake/mlir \
  -DCMAKE_CXX_COMPILER=/path/to/llvm-install/bin/clang++
cmake --build /tmp/mlir-effects-lab
```

插件和宿主工具必须使用兼容的头文件、配置和 ABI，不能把另一套 Clang/LLVM 静态库
再打包进 Analyzer 插件。MLIR 示例使用框架自身 TypeID，不依赖 C++ RTTI。

`FileState` 仅建模 `tutorial_open/close/take` 的显式契约，不是所有文件 API 的完整检查器。
未知逃逸会停止所有权追踪，避免虚假的泄漏结论，但也意味着可能漏报。MulToShift 只处理
位宽至少为 3 的标量整数，回归包含不应改写的 `i2 nsw`、浮点和向量。

ARM64 检查只交叉生成汇编/目标文件，不执行 ARM64 二进制。x86-64-v3 向量示例也仅
检查生成 IR；实际执行相关机器码前仍需确认设备具备相应 CPU 特性。
