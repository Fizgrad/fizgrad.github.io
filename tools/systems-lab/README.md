# Systems Lab

一组可在网页中接受 AI 静态评审、也可在 Linux 本地编译运行的 C++20 系统编程练习。当前覆盖 `select`、`poll`、`epoll`、可关闭有界队列、固定线程池和长度前缀 Socket I/O。

## 两种验证方式

- 网页 AI 评审：把题目契约、用户代码和可选的本地测试输出发送给 DeepSeek，返回固定 JSON 结构。完整系统提示词在 [`JUDGE_PROMPT.md`](JUDGE_PROMPT.md)。
- 本地确定性测试：编译代码后，用真实 pipe、socketpair、线程、超时和 fd 计数检查行为。

AI 评审擅长发现漏掉的分支和解释原因，但静态阅读不能证明没有死锁、数据竞争、阻塞或描述符泄漏。因此网页不会把 AI 结论伪装成运行结果。

## 本地使用

要求 Linux、Python 3.9+ 和支持 C++20 的 `g++`/`clang++`：

网页中的下载按钮会保存 `systems-lab-linux.sh`：

```bash
sh systems-lab-linux.sh
```

脚本默认安装到 `tools/systems-lab`，也可以把目标目录作为第一个参数传入。

```bash
python3 tools/systems-lab/practice.py doctor
python3 tools/systems-lab/practice.py list
python3 tools/systems-lab/practice.py show epoll-ready
python3 tools/systems-lab/practice.py init epoll-ready
python3 tools/systems-lab/practice.py run epoll-ready
```

`init` 默认把可编辑文件写到 `systems-lab-work/<题目 ID>/solution.cpp`。也可以直接测试其他文件：

```bash
python3 tools/systems-lab/practice.py run epoll-ready --solution /path/to/solution.cpp
```

增加运行次数或启用 sanitizer：

```bash
python3 tools/systems-lab/practice.py run bounded-queue --repeat 100
python3 tools/systems-lab/practice.py run bounded-queue --sanitizer thread --repeat 20
python3 tools/systems-lab/practice.py run framed-socket --sanitizer address
```

运行内置参考实现，验证题目与测试框架本身：

```bash
python3 tools/systems-lab/practice.py self-test
```

## 安全边界

- 网页中的 DeepSeek Key 只保存在当前页面内存，不写入 `localStorage`、`sessionStorage`、Cookie 或仓库；请求由浏览器直接发往 DeepSeek。
- 代码和可选测试输出会发送给 DeepSeek，页面会在提交前明确提示。
- 本地 runner **不是安全沙箱**，会以当前用户权限执行提交的 C++。只运行可信代码；不可信代码应放进权限受限的一次性容器或虚拟机。
- 公共测试用于快速反馈，不代表覆盖全部系统调用时序。并发题仍应配合重复运行、ThreadSanitizer 和针对性故障注入。

## 添加题目

1. 在 `challenges/<id>/` 中加入 `starter.cpp`、`tests.cpp` 和 `reference.cpp`。
2. 在 `problems.json` 中加入中英双语契约、API、检查项和文件路径。
3. 执行 `python3 tools/systems-lab/practice.py self-test <id>`。

测试文件通过临时目录中的 `solution.cpp` 引入提交代码；参考实现只用于仓库自测，不会在网页 AI 请求中发送。
