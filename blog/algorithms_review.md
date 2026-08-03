# 算法与数据结构 C/C++

# 1. 复杂度与算法分析

## 1.1 Big O 描述什么

渐进复杂度描述输入规模增大时，资源消耗的增长趋势。分析时至少要区分：

- **最坏复杂度**：所有合法输入中的最大开销；
- **平均复杂度**：依赖输入分布，不能凭直觉声称；
- **期望复杂度**：通常还包含随机算法或哈希函数的随机性；
- **均摊复杂度**：一串操作的总成本除以操作次数；
- **空间复杂度**：额外空间还是包含输入本身，要明确口径。

常见增长速度：

```text
O(1)
< O(log n)
< O(n)
< O(n log n)
< O(n^2)
< O(2^n)
< O(n!)
```

常数并非永远不重要。两个算法同为 `O(n)`，连续扫描和随机指针追逐在真实 CPU 上可能相差很大；缓存局部性、分支预测、向量化和内存分配不会完整体现在 Big O 中。

## 1.2 循环如何计算

顺序执行通常相加，嵌套执行通常相乘：

```cpp
for (std::size_t i = 0; i < n; ++i) {        // n 次
    for (std::size_t j = 0; j < n; ++j) {    // 每次 n 次
        consume(i, j);                        // O(1)
    }
}
// O(n^2)
```

变量按倍数增长通常是对数级：

```cpp
for (std::size_t x = 1; x < n; x *= 2) {
    consume(x);
}
// O(log n)
```

不要见到两层循环就直接断定为 `O(n^2)`：

```cpp
for (std::size_t i = 0; i < n; ++i) {
    for (std::size_t j = i; j > 0; j /= 2) {
        consume(i, j);
    }
}
// O(n log n)
```

## 1.3 递归复杂度

递归需要同时考虑：

- 子问题数量；
- 子问题规模；
- 每层额外工作；
- 递归深度造成的栈空间。

归并排序的递推式：

```text
T(n) = 2T(n / 2) + O(n)
     = O(n log n)
```

二分查找：

```text
T(n) = T(n / 2) + O(1)
     = O(log n)
```

朴素 Fibonacci：

```text
T(n) = T(n - 1) + T(n - 2) + O(1)
     = O(phi^n)，常粗略写作 O(2^n)
```

## 1.4 均摊分析

`std::vector::push_back` 通常是均摊 `O(1)`。扩容那一次需要移动或拷贝已有元素，是 `O(n)`；但容量按常数倍增长时，连续插入 `n` 个元素的总搬迁量仍是 `O(n)`。

三种常见均摊证明方法：

- 聚合分析：直接计算整串操作总成本；
- 记账法：便宜操作预存“余额”支付未来昂贵操作；
- 势能法：用数据结构状态的势能变化分摊成本。

## 1.5 复杂度分析模板

不要只说一个结果：

> 每个顶点只入队一次，每条有向边只检查一次，因此时间复杂度是 `O(V + E)`；邻接表占 `O(V + E)`，队列和访问数组占 `O(V)`。如果输入改为邻接矩阵，即使边很少也需要扫描 `V^2` 个位置。

---

# 2. 数组、字符串与连续内存

## 2.1 为什么数组重要

数组元素连续，具有：

- `O(1)` 随机访问；
- 良好的空间局部性；
- 中间插入、删除通常需要搬移 `O(n)` 个元素；
- 固定数组必须显式管理容量；
- `std::vector` 自动管理动态连续存储，但扩容会使迭代器、引用和指针失效。

C 接口传入数组后通常只剩指针，长度不会自动保留：

```c
long long sum_array(const int *data, size_t size) {
    long long sum = 0;
    for (size_t i = 0; i < size; ++i) {
        sum += data[i];
    }
    return sum;
}
```

长度必须作为参数传入，并且只有在 `size > 0` 时才允许解引用 `data`。

## 2.2 双指针

双指针不是单一算法，而是利用单调性减少重复扫描。

常见形态：

- 两端向中间：有序数组两数和、回文判断；
- 快慢指针：链表环、原地去重；
- 同向窗口：满足约束的最长或最短连续区间；
- 归并指针：合并两个有序序列。

有序数组两数和：

```cpp
#include <optional>
#include <utility>
#include <vector>

std::optional<std::pair<std::size_t, std::size_t>>
two_sum_sorted(const std::vector<int>& values, long long target) {
    if (values.size() < 2) {
        return std::nullopt;
    }

    std::size_t left = 0;
    std::size_t right = values.size() - 1;
    while (left < right) {
        const long long sum =
            static_cast<long long>(values[left]) + values[right];
        if (sum == target) {
            return std::pair{left, right};
        }
        if (sum < target) {
            ++left;
        } else {
            --right;
        }
    }
    return std::nullopt;
}
```

关键不变量：答案若仍存在，就一定在闭区间 `[left, right]` 中。数组有序才能根据和的大小安全排除一端。

## 2.3 滑动窗口

适合连续子数组或子串，并且左右边界能单调前进的问题。

最长无重复字节子串：

```cpp
#include <algorithm>
#include <array>
#include <string_view>

std::size_t longest_unique_substring(std::string_view text) {
    std::array<std::size_t, 256> next_allowed{};
    std::size_t left = 0;
    std::size_t best = 0;

    for (std::size_t right = 0; right < text.size(); ++right) {
        const auto byte = static_cast<unsigned char>(text[right]);
        left = std::max(left, next_allowed[byte]);
        best = std::max(best, right - left + 1);
        next_allowed[byte] = right + 1;
    }
    return best;
}
```

这里处理的是字节，不是 Unicode 字符。UTF-8 中一个用户可见字符可能占多个字节；如果题目按 Unicode code point 或 grapheme cluster 定义，就必须先明确编码语义。

## 2.4 前缀和

前缀和把多次区间求和从每次 `O(n)` 降为预处理 `O(n)`、查询 `O(1)`。

定义半开区间前缀：

```text
prefix[0] = 0
prefix[i + 1] = prefix[i] + values[i]
sum([left, right)) = prefix[right] - prefix[left]
```

```cpp
#include <stdexcept>
#include <vector>

class PrefixSum {
public:
    explicit PrefixSum(const std::vector<int>& values)
        : prefix_(values.size() + 1, 0) {
        for (std::size_t i = 0; i < values.size(); ++i) {
            prefix_[i + 1] = prefix_[i] + values[i];
        }
    }

    long long query(std::size_t left, std::size_t right) const {
        if (left > right || right >= prefix_.size()) {
            throw std::out_of_range("invalid half-open range");
        }
        return prefix_[right] - prefix_[left];
    }

private:
    std::vector<long long> prefix_;
};
```

二维前缀和常用于矩形区域查询；差分数组则反过来擅长批量区间加法。

## 2.5 连续子数组与 Kadane

最大连续子数组和：

```cpp
#include <algorithm>
#include <optional>
#include <vector>

std::optional<long long> max_subarray_sum(const std::vector<int>& values) {
    if (values.empty()) {
        return std::nullopt;
    }

    long long ending_here = values.front();
    long long best = ending_here;
    for (std::size_t i = 1; i < values.size(); ++i) {
        ending_here = std::max<long long>(values[i], ending_here + values[i]);
        best = std::max(best, ending_here);
    }
    return best;
}
```

状态含义比公式更重要：`ending_here` 是“必须以当前位置结尾”的最大和，`best` 是目前见过的全局最大和。

---

# 3. 链表

链表的随机访问是 `O(n)`，但已知节点位置时插入、删除可以是 `O(1)`。真实机器上，节点分散分配会带来缓存不命中和分配开销，所以链表并不天然比 `vector` 快。

```cpp
struct ListNode {
    int value{};
    ListNode* next{};
};
```

## 3.1 反转单链表

```cpp
ListNode* reverse_list(ListNode* head) {
    ListNode* previous = nullptr;
    while (head != nullptr) {
        ListNode* next = head->next;
        head->next = previous;
        previous = head;
        head = next;
    }
    return previous;
}
```

循环不变量：`previous` 始终指向已经反转完成的前缀，`head` 指向尚未处理的后缀。

这段代码只重连指针，不分配和释放节点；节点所有权仍由调用者负责。

## 3.2 快慢指针判环

```cpp
bool has_cycle(const ListNode* head) {
    const ListNode* slow = head;
    const ListNode* fast = head;
    while (fast != nullptr && fast->next != nullptr) {
        slow = slow->next;
        fast = fast->next->next;
        if (slow == fast) {
            return true;
        }
    }
    return false;
}
```

如果存在环，快指针相对慢指针每轮多走一步，最终会在环内相遇。继续推导还可以在 `O(1)` 空间找到环入口。

## 3.3 合并两个有序链表

```cpp
ListNode* merge_sorted_lists(ListNode* a, ListNode* b) {
    ListNode dummy;
    ListNode* tail = &dummy;

    while (a != nullptr && b != nullptr) {
        ListNode*& chosen = (a->value <= b->value) ? a : b;
        tail->next = chosen;
        chosen = chosen->next;
        tail = tail->next;
    }
    tail->next = (a != nullptr) ? a : b;
    return dummy.next;
}
```

哑节点可以统一处理头节点，减少“第一次插入”的特殊分支。

## 3.4 常见链表问题

- 删除倒数第 `k` 个节点：前后指针保持 `k` 个节点距离；
- 相交链表：两个指针分别走 `A + B` 和 `B + A`；
- 回文链表：找中点、反转后半段、比较，必要时恢复结构；
- K 路合并：最小堆保存每条链表当前头，复杂度 `O(N log k)`；
- LRU：哈希表负责 `O(1)` 定位，双向链表负责 `O(1)` 调整新旧顺序。

---

# 4. 栈、队列与单调结构

## 4.1 基本语义

- 栈：后进先出，适合括号匹配、表达式求值、DFS、函数调用；
- 队列：先进先出，适合 BFS、生产消费、分层处理；
- 双端队列：两端插入删除，适合滑动窗口最大值和 0-1 BFS；
- 优先队列：每次取最高优先级元素，通常由堆实现。

不要用 `std::vector::erase(begin())` 模拟队列，因为每次会移动后续元素。使用 `std::queue` 或 `std::deque`。

## 4.2 单调栈

“每个位置右侧第一个更大元素”：

```cpp
#include <stack>
#include <vector>

std::vector<int> next_greater_value(const std::vector<int>& values) {
    std::vector<int> answer(values.size(), -1);
    std::stack<std::size_t> indices;

    for (std::size_t i = 0; i < values.size(); ++i) {
        while (!indices.empty() && values[indices.top()] < values[i]) {
            answer[indices.top()] = values[i];
            indices.pop();
        }
        indices.push(i);
    }
    return answer;
}
```

每个下标最多入栈、出栈各一次，因此总复杂度是 `O(n)`，不是 while 嵌套看起来的 `O(n^2)`。

单调栈常见题：柱状图最大矩形、每日温度、接雨水、贡献法计算子数组最值。

## 4.3 单调队列

固定窗口最大值维护一个下标双端队列：

- 队首始终是当前窗口最大值下标；
- 新元素进入前，从队尾删除所有不可能再成为最大值的元素；
- 队首越过左边界时弹出。

同样因为每个元素最多进出一次，总复杂度是 `O(n)`。

---

# 5. 哈希表

哈希表把键映射到桶。平均查找、插入和删除通常是 `O(1)`，但最坏可以退化为 `O(n)`。必须理解：

- 哈希函数应尽量均匀；
- 冲突可用链式结构或开放寻址解决；
- 负载因子过高会增加冲突；
- rehash 是昂贵操作，并可能使迭代器失效；
- 哈希表通常不保证遍历顺序；
- 对抗性输入可能构造大量冲突。

## 5.1 何时使用

- 两数和、计数、去重；
- 记录节点是否访问；
- 建立值到位置、ID 到对象的索引；
- 缓存和记忆化搜索。

如果需要有序遍历、范围查询或稳定的最坏 `O(log n)`，考虑树结构；如果键是小范围整数，数组或位图通常更快。

## 5.2 自定义键

相等关系与哈希必须一致：如果 `a == b`，则必须有 `hash(a) == hash(b)`。

```cpp
#include <cstddef>
#include <functional>
#include <unordered_map>

struct Point {
    int x{};
    int y{};

    bool operator==(const Point& other) const noexcept {
        return x == other.x && y == other.y;
    }
};

struct PointHash {
    std::size_t operator()(const Point& p) const noexcept {
        const std::size_t h1 = std::hash<int>{}(p.x);
        const std::size_t h2 = std::hash<int>{}(p.y);
        return h1 ^ (h2 + 0x9e3779b9U + (h1 << 6U) + (h1 >> 2U));
    }
};

using PointTable = std::unordered_map<Point, int, PointHash>;
```

## 5.3 常见错误

- 在遍历过程中触发 rehash，却继续使用旧迭代器；
- 用 `operator[]` 做纯查询，意外插入默认值；
- 认为平均 `O(1)` 就没有常数和缓存代价；
- 对浮点数直接做精确相等和哈希；
- 自定义比较与哈希不一致。

---

# 6. 排序、选择与 Top K

## 6.1 常见排序比较

| 算法 | 平均时间 | 最坏时间 | 额外空间 | 稳定 | 备注 |
|---|---:|---:|---:|---|---|
| 插入排序 | `O(n^2)` | `O(n^2)` | `O(1)` | 是 | 小规模或近乎有序时很好 |
| 归并排序 | `O(n log n)` | `O(n log n)` | `O(n)` | 是 | 顺序访问，适合外排序 |
| 快速排序 | `O(n log n)` | `O(n^2)` | 平均 `O(log n)` 栈 | 否 | 缓存友好，需良好 pivot |
| 堆排序 | `O(n log n)` | `O(n log n)` | `O(1)` | 否 | 最坏有保证，局部性较差 |
| 计数排序 | `O(n + k)` | `O(n + k)` | `O(k)` | 可实现为稳定 | 键范围 `k` 不能太大 |

基于比较的通用排序在决策树模型下有 `Omega(n log n)` 下界。计数、基数排序利用了键的额外结构，因此不受该比较下界约束。

## 6.2 归并排序

使用半开区间 `[first, last)` 能减少边界错误：

```cpp
#include <algorithm>
#include <vector>

void merge_sort_impl(std::vector<int>& values,
                     std::vector<int>& buffer,
                     std::size_t first,
                     std::size_t last) {
    if (last - first <= 1) {
        return;
    }

    const std::size_t middle = first + (last - first) / 2;
    merge_sort_impl(values, buffer, first, middle);
    merge_sort_impl(values, buffer, middle, last);

    std::size_t i = first;
    std::size_t j = middle;
    std::size_t out = first;
    while (i < middle && j < last) {
        if (values[i] <= values[j]) {
            buffer[out++] = values[i++];
        } else {
            buffer[out++] = values[j++];
        }
    }
    while (i < middle) buffer[out++] = values[i++];
    while (j < last) buffer[out++] = values[j++];
    std::copy(buffer.begin() + static_cast<std::ptrdiff_t>(first),
              buffer.begin() + static_cast<std::ptrdiff_t>(last),
              values.begin() + static_cast<std::ptrdiff_t>(first));
}

void merge_sort(std::vector<int>& values) {
    std::vector<int> buffer(values.size());
    merge_sort_impl(values, buffer, 0, values.size());
}
```

合并时相等元素优先取左侧，才能保持稳定性。

## 6.3 三路快速排序

三路划分对大量重复元素更稳健：

```cpp
#include <algorithm>
#include <functional>
#include <random>
#include <vector>

void quick_sort(std::vector<int>& values) {
    if (values.size() < 2) return;

    std::mt19937 engine(std::random_device{}());
    std::function<void(std::ptrdiff_t, std::ptrdiff_t)> sort_range =
        [&](std::ptrdiff_t left, std::ptrdiff_t right) {
            if (left >= right) return;

            std::uniform_int_distribution<std::ptrdiff_t> choose(left, right);
            const int pivot = values[static_cast<std::size_t>(choose(engine))];
            std::ptrdiff_t less = left;
            std::ptrdiff_t current = left;
            std::ptrdiff_t greater = right;

            while (current <= greater) {
                int& value = values[static_cast<std::size_t>(current)];
                if (value < pivot) {
                    std::swap(values[static_cast<std::size_t>(less++)], value);
                    ++current;
                } else if (value > pivot) {
                    std::swap(value, values[static_cast<std::size_t>(greater--)]);
                } else {
                    ++current;
                }
            }
            sort_range(left, less - 1);
            sort_range(greater + 1, right);
        };

    sort_range(0, static_cast<std::ptrdiff_t>(values.size()) - 1);
}
```

生产代码通常应优先使用 `std::sort`。标准库实现会综合处理小数组、递归深度和最坏情况；手写实现用于理解划分不变量，而不是替代标准库。

## 6.4 Top K 的选择

| 场景 | 常见方案 | 复杂度 |
|---|---|---|
| 一次找第 `k` 小 | Quickselect / `std::nth_element` | 平均 `O(n)` |
| 海量流中保留最大 K 个 | 大小为 K 的最小堆 | `O(n log k)` |
| K 接近 n 且需要整体有序 | 排序 | `O(n log n)` |
| 小范围整数 | 计数或桶 | `O(n + range)` |

Quickselect 只保证目标元素处于排序后位置，并不保证两侧各自有序。若要求最坏线性时间，可以使用 median-of-medians，但常数较大。

---

# 7. 二分查找

二分查找的本质不是“找一个值”，而是在具有单调性的搜索空间中寻找边界。

## 7.1 `lower_bound` 的不变量

寻找第一个不小于 `target` 的位置：

```cpp
#include <vector>

std::size_t lower_bound_index(const std::vector<int>& values, int target) {
    std::size_t first = 0;
    std::size_t last = values.size();

    while (first < last) {
        const std::size_t middle = first + (last - first) / 2;
        if (values[middle] < target) {
            first = middle + 1;
        } else {
            last = middle;
        }
    }
    return first;
}
```

循环维持：

- `[0, first)` 中的元素都小于 `target`；
- `[last, n)` 中的元素都不小于 `target`；
- 未判定区域是 `[first, last)`。

返回值可能等于 `values.size()`，调用者不能直接解引用。

## 7.2 常见边界变体

- 第一个 `>= target`：`lower_bound`；
- 第一个 `> target`：`upper_bound`；
- 最后一个 `< target`：`lower_bound - 1`，但要检查是否存在；
- 最后一个 `<= target`：`upper_bound - 1`；
- 旋转数组：根据一侧是否有序排除区间；
- 二维矩阵：确认题目给出的全局或行列单调性。

## 7.3 对答案二分

如果存在单调谓词：

```text
false false false true true true
```

就可以找第一个 `true`。典型问题包括最小容量、最大可行距离、最短完成时间。

```cpp
#include <cstdint>
#include <functional>

std::int64_t first_feasible(std::int64_t low,
                            std::int64_t high,
                            const std::function<bool(std::int64_t)>& feasible) {
    // 约定答案存在于闭区间 [low, high]。
    while (low < high) {
        const std::int64_t middle = low + (high - low) / 2;
        if (feasible(middle)) {
            high = middle;
        } else {
            low = middle + 1;
        }
    }
    return low;
}
```

使用时必须解释为什么 `feasible(x)` 单调，以及上下界为什么覆盖答案。

---

# 8. 树、堆与 Trie

## 8.1 二叉树遍历

```cpp
struct TreeNode {
    int value{};
    TreeNode* left{};
    TreeNode* right{};
};
```

递归前序遍历很直观，但深度很大时可能栈溢出。迭代版本：

```cpp
#include <stack>
#include <vector>

std::vector<int> preorder(const TreeNode* root) {
    std::vector<int> order;
    if (root == nullptr) return order;

    std::stack<const TreeNode*> pending;
    pending.push(root);
    while (!pending.empty()) {
        const TreeNode* node = pending.top();
        pending.pop();
        order.push_back(node->value);
        if (node->right != nullptr) pending.push(node->right);
        if (node->left != nullptr) pending.push(node->left);
    }
    return order;
}
```

因为栈是后进先出，要先压右子树，再压左子树。

层序遍历使用队列；如果需要分层，在每轮开始记录当前队列长度。

## 8.2 二叉搜索树

BST 满足左子树键小于当前键、右子树键大于当前键，重复键策略必须另行约定。

- 平均查找 `O(log n)`；
- 极端退化为链表时是 `O(n)`；
- AVL、红黑树等平衡树保证高度为 `O(log n)`；
- 中序遍历按键有序。

验证 BST 时不要只比较父子节点；应向下传递整个允许范围，并注意 `INT_MIN/INT_MAX` 边界。

## 8.3 堆与优先队列

二叉堆通常存储在数组中。以零开始下标：

```text
parent(i) = (i - 1) / 2      // i > 0
left(i)   = 2 * i + 1
right(i)  = 2 * i + 2
```

- 读取堆顶 `O(1)`；
- 插入 `O(log n)`；
- 删除堆顶 `O(log n)`；
- 从数组自底向上建堆是 `O(n)`，不是 `O(n log n)`。

`std::priority_queue` 默认是最大堆：

```cpp
#include <functional>
#include <queue>
#include <vector>

std::priority_queue<int, std::vector<int>, std::greater<int>> min_heap;
```

堆适合动态地反复获取极值，不适合查任意元素。

## 8.4 Trie

Trie 按字符边组织前缀。查询复杂度取决于键长度 `L`，通常写作 `O(L)`，但空间可能很大。

子节点表示方式需要根据字符集选择：

- 固定小字符集：数组，查询快但可能浪费空间；
- 大字符集：哈希表或有序映射；
- 压缩 Trie / Radix Tree：合并单分支路径。

应用包括前缀查询、自动补全、路由表和字符串集合匹配。

---

# 9. 图算法

图是编译器 CFG、调用图、依赖图、计算图、任务调度和网络拓扑的共同抽象。

## 9.1 图的表示

| 表示 | 空间 | 判断任意边 | 遍历邻居 | 适用场景 |
|---|---:|---:|---:|---|
| 邻接矩阵 | `O(V^2)` | `O(1)` | `O(V)` | 稠密小图 |
| 邻接表 | `O(V + E)` | 通常与度数相关 | `O(deg(v))` | 稀疏图 |
| 边列表 | `O(E)` | `O(E)` | `O(E)` | Kruskal、批处理边 |

下面统一使用：

```cpp
using Graph = std::vector<std::vector<std::size_t>>;
```

构图时必须验证顶点编号；无向边要加入两个方向，但统计边数时不要误算。

## 9.2 BFS

BFS 按无权最短距离逐层扩展：

```cpp
#include <cstddef>
#include <limits>
#include <queue>
#include <vector>

using Graph = std::vector<std::vector<std::size_t>>;

std::vector<std::size_t> bfs_distance(const Graph& graph, std::size_t source) {
    const std::size_t unreachable = std::numeric_limits<std::size_t>::max();
    std::vector<std::size_t> distance(graph.size(), unreachable);
    if (source >= graph.size()) return distance;

    std::queue<std::size_t> pending;
    distance[source] = 0;
    pending.push(source);

    while (!pending.empty()) {
        const std::size_t node = pending.front();
        pending.pop();
        for (const std::size_t next : graph[node]) {
            if (next >= graph.size()) continue; // 生产代码应在构图时拒绝非法边
            if (distance[next] != unreachable) continue;
            distance[next] = distance[node] + 1;
            pending.push(next);
        }
    }
    return distance;
}
```

访问标记应在入队时设置，否则同一节点可能被多次入队。

## 9.3 DFS

DFS 适合可达性、连通分量、环检测、拓扑序和回溯。迭代版本避免深图栈溢出：

```cpp
#include <stack>

std::vector<std::size_t> dfs_preorder(const Graph& graph, std::size_t source) {
    std::vector<std::size_t> order;
    if (source >= graph.size()) return order;

    std::vector<bool> visited(graph.size(), false);
    std::stack<std::size_t> pending;
    pending.push(source);

    while (!pending.empty()) {
        const std::size_t node = pending.top();
        pending.pop();
        if (visited[node]) continue;
        visited[node] = true;
        order.push_back(node);

        for (auto it = graph[node].rbegin(); it != graph[node].rend(); ++it) {
            if (*it < graph.size() && !visited[*it]) pending.push(*it);
        }
    }
    return order;
}
```

有向图环检测常用三色标记：未访问、正在当前递归栈、已经完成。遇到指向“正在访问”节点的边就是 back edge。

## 9.4 拓扑排序

Kahn 算法不断删除入度为零的节点：

```cpp
#include <optional>

std::optional<std::vector<std::size_t>> topological_sort(const Graph& graph) {
    std::vector<std::size_t> indegree(graph.size(), 0);
    for (const auto& edges : graph) {
        for (const std::size_t to : edges) {
            if (to >= graph.size()) return std::nullopt;
            ++indegree[to];
        }
    }

    std::queue<std::size_t> ready;
    for (std::size_t i = 0; i < graph.size(); ++i) {
        if (indegree[i] == 0) ready.push(i);
    }

    std::vector<std::size_t> order;
    while (!ready.empty()) {
        const std::size_t node = ready.front();
        ready.pop();
        order.push_back(node);
        for (const std::size_t next : graph[node]) {
            if (--indegree[next] == 0) ready.push(next);
        }
    }

    if (order.size() != graph.size()) return std::nullopt;
    return order;
}
```

只有 DAG 存在拓扑序；拓扑序可能不唯一。编译依赖、构建系统和指令调度都会用到这一思想。

## 9.5 并查集

并查集维护动态等价类，支持合并和连通性查询：

```cpp
#include <numeric>

class DisjointSet {
public:
    explicit DisjointSet(std::size_t size)
        : parent_(size), rank_(size, 0) {
        std::iota(parent_.begin(), parent_.end(), 0);
    }

    std::size_t find(std::size_t node) {
        if (parent_[node] != node) {
            parent_[node] = find(parent_[node]);
        }
        return parent_[node];
    }

    bool unite(std::size_t a, std::size_t b) {
        a = find(a);
        b = find(b);
        if (a == b) return false;

        if (rank_[a] < rank_[b]) std::swap(a, b);
        parent_[b] = a;
        if (rank_[a] == rank_[b]) ++rank_[a];
        return true;
    }

private:
    std::vector<std::size_t> parent_;
    std::vector<unsigned char> rank_;
};
```

路径压缩加按秩合并后，单次操作的均摊复杂度是 `O(alpha(n))`，逆 Ackermann 函数在实际规模下近似常数。

## 9.6 Dijkstra

适用于边权非负的单源最短路：

```cpp
#include <functional>
#include <limits>
#include <queue>
#include <stdexcept>
#include <utility>

using WeightedGraph =
    std::vector<std::vector<std::pair<std::size_t, long long>>>;

std::vector<long long> dijkstra(const WeightedGraph& graph, std::size_t source) {
    const long long infinity = std::numeric_limits<long long>::max();
    std::vector<long long> distance(graph.size(), infinity);
    if (source >= graph.size()) return distance;

    for (const auto& edges : graph) {
        for (const auto& [next, weight] : edges) {
            if (next >= graph.size()) {
                throw std::out_of_range("invalid graph edge");
            }
            if (weight < 0) {
                throw std::invalid_argument("Dijkstra requires non-negative edges");
            }
        }
    }

    using Item = std::pair<long long, std::size_t>;
    std::priority_queue<Item, std::vector<Item>, std::greater<Item>> pending;
    distance[source] = 0;
    pending.push({0, source});

    while (!pending.empty()) {
        const auto [current_distance, node] = pending.top();
        pending.pop();
        if (current_distance != distance[node]) continue;

        for (const auto& [next, weight] : graph[node]) {
            if (current_distance > infinity - weight) continue;
            const long long candidate = current_distance + weight;
            if (candidate < distance[next]) {
                distance[next] = candidate;
                pending.push({candidate, next});
            }
        }
    }
    return distance;
}
```

标准 `priority_queue` 不提供 decrease-key，常用做法是把新距离再次入堆，弹出时跳过旧条目。

## 9.7 图算法选择

| 问题 | 算法 | 关键前提 |
|---|---|---|
| 无权最短路 | BFS | 每条边代价相同 |
| 边权为 0 或 1 | 0-1 BFS | 用 deque |
| 非负权单源最短路 | Dijkstra | 不能有负权边 |
| 可有负权的单源最短路 | Bellman-Ford | 可检测可达负环 |
| DAG 最短/最长路 | 拓扑序 DP | 图必须是 DAG |
| 全源最短路 | Floyd-Warshall | `O(V^3)`，适合小而稠密的图 |
| 最小生成树 | Kruskal / Prim | 无向连通带权图 |
| 强连通分量 | Tarjan / Kosaraju | 有向图 |

最短路与最小生成树目标不同：最短路优化源点到各点的路径；最小生成树优化连接所有顶点的总边权。

---

# 10. 递归、回溯与搜索

## 10.1 递归的四个问题

写递归前先明确：

1. 函数参数代表什么状态；
2. 终止条件是什么；
3. 当前层有哪些选择；
4. 返回上一层前需要恢复什么状态。

递归代码短，但递归深度受线程栈限制。树高、图深或输入长度可达几十万时，应优先考虑显式栈。

## 10.2 回溯模板

```text
search(state):
    if state 是完整答案:
        记录答案
        return

    for choice in 当前可选集合:
        if choice 不合法:
            continue
        应用 choice
        search(next_state)
        撤销 choice
```

含重复元素的全排列：

```cpp
#include <algorithm>
#include <vector>

void collect_permutations(const std::vector<int>& values,
                          std::vector<bool>& used,
                          std::vector<int>& current,
                          std::vector<std::vector<int>>& result) {
    if (current.size() == values.size()) {
        result.push_back(current);
        return;
    }

    for (std::size_t i = 0; i < values.size(); ++i) {
        if (used[i]) continue;
        if (i > 0 && values[i] == values[i - 1] && !used[i - 1]) continue;

        used[i] = true;
        current.push_back(values[i]);
        collect_permutations(values, used, current, result);
        current.pop_back();
        used[i] = false;
    }
}

std::vector<std::vector<int>> unique_permutations(std::vector<int> values) {
    std::sort(values.begin(), values.end());
    std::vector<std::vector<int>> result;
    std::vector<int> current;
    std::vector<bool> used(values.size(), false);
    collect_permutations(values, used, current, result);
    return result;
}
```

去重条件表示：同一搜索层中，相同值只选择最靠前的尚未使用副本。排序是该判断成立的前提。

## 10.3 剪枝

有效剪枝必须保证不会删除可能产生更优答案的分支：

- 可行性剪枝：已经违反硬约束；
- 上下界剪枝：即使后续达到理论最好也不可能超过当前答案；
- 对称性剪枝：不同选择会产生等价状态；
- 记忆化：相同状态无需重复搜索；
- 排序后提前停止：剩余候选具有单调性。

分析时要说明剪枝为什么安全，而不是只说“这样更快”。

## 10.4 BFS、DFS 与双向搜索

- 求最短步数且每步代价相同：BFS；
- 只需任意可行解或需要回溯路径：DFS；
- 起点和终点明确、状态分支多且近似可逆：双向 BFS；
- 状态带不同非负代价：Dijkstra；
- 有启发函数并要求高效找到路径：A*，启发函数的可采纳性决定最优性。

---

# 11. 贪心与区间问题

贪心算法每一步做局部选择，并希望得到全局最优。写出代码之前应能提供以下一种证明：

- 交换论证：任意最优解都能替换为贪心选择而不变差；
- 领先法：贪心解在每个前缀上都不落后；
- 切分性质：某个局部选择必然存在于某个最优解中；
- 反证法：假设第一次偏离贪心选择能更优，推出矛盾。

## 11.1 最大不重叠区间数

按结束位置从小到大选择：

```cpp
#include <algorithm>
#include <limits>
#include <optional>
#include <utility>
#include <vector>

std::optional<std::size_t> max_non_overlapping_intervals(
    std::vector<std::pair<int, int>> intervals) {
    for (const auto& [start, finish] : intervals) {
        if (start > finish) return std::nullopt;
    }

    std::sort(intervals.begin(), intervals.end(),
              [](const auto& a, const auto& b) {
                  if (a.second != b.second) return a.second < b.second;
                  return a.first < b.first;
              });

    std::size_t selected = 0;
    int previous_end = std::numeric_limits<int>::min();
    for (const auto& [start, finish] : intervals) {
        if (start >= previous_end) {
            ++selected;
            previous_end = finish;
        }
    }
    return selected;
}
```

约定区间是半开还是闭区间会影响 `start >= previous_end` 是否允许端点相接，实现前要先明确。

交换论证：在所有可选区间中，结束最早的区间给后续留下最大空间；把任一最优解的第一个区间换成它，不会减少后续可选择区间数。

## 11.2 常见区间题

- 合并区间：按起点排序，维护当前合并区间；
- 区间交集：两个有序区间列表使用双指针；
- 最少会议室：按起点处理，并用最小堆维护最早结束时间；
- 扫描线：把起止事件排序，注意同坐标事件的先后规则；
- 区间覆盖：每一步选择能把已覆盖右端点扩展最远的区间。

## 11.3 贪心不成立的信号

- 局部选择会改变后续选择价值；
- 需要记录容量、余额、剩余次数等状态；
- 很难写出交换论证；
- 相似问题只改变一个约束后答案就不同。

例如 0/1 背包一般不能按单位价值贪心，而分数背包可以。

---

# 12. 动态规划

动态规划适用于具有重叠子问题和最优子结构的问题。不要从“套公式”开始，而要依次定义：

1. **状态**：`dp[...]` 精确表示什么；
2. **转移**：最后一步或最后一个决策是什么；
3. **初值**：最小子问题的答案；
4. **遍历顺序**：计算当前状态时依赖是否已经就绪；
5. **答案位置**：哪个状态是最终答案；
6. **无效状态**：用什么值表示，是否会溢出。

## 12.1 从递归到 DP

若搜索状态只由少量参数决定，可先写递归关系，再加记忆化：

```text
solve(state):
    if state 已缓存: return cache[state]
    answer = combine(solve(smaller_state), ...)
    cache[state] = answer
    return answer
```

自顶向下只访问实际需要的状态；自底向上没有递归开销，通常更容易压缩空间。

## 12.2 0/1 背包

每件物品只能选一次。`dp[c]` 表示容量不超过 `c` 时的最大价值：

```cpp
#include <algorithm>
#include <stdexcept>
#include <vector>

long long zero_one_knapsack(const std::vector<int>& weight,
                            const std::vector<int>& value,
                            int capacity) {
    if (weight.size() != value.size() || capacity < 0) {
        throw std::invalid_argument("invalid knapsack input");
    }

    std::vector<long long> dp(static_cast<std::size_t>(capacity) + 1, 0);
    for (std::size_t item = 0; item < weight.size(); ++item) {
        if (weight[item] < 0) {
            throw std::invalid_argument("negative weight");
        }
        for (int c = capacity; c >= weight[item]; --c) {
            dp[static_cast<std::size_t>(c)] = std::max(
                dp[static_cast<std::size_t>(c)],
                dp[static_cast<std::size_t>(c - weight[item])] + value[item]);
        }
    }
    return dp.back();
}
```

容量必须倒序，避免当前物品在同一轮被重复使用。完全背包允许重复选择，容量通常正序。

## 12.3 最长递增子序列

`O(n^2)` DP 很直观：`dp[i]` 表示以 `i` 结尾的 LIS 长度。

更优的 `O(n log n)` 解法维护：`tails[len - 1]` 是长度为 `len` 的递增子序列所能取得的最小末尾值。

```cpp
#include <algorithm>
#include <vector>

std::size_t longest_increasing_subsequence(const std::vector<int>& values) {
    std::vector<int> tails;
    for (const int value : values) {
        auto position = std::lower_bound(tails.begin(), tails.end(), value);
        if (position == tails.end()) {
            tails.push_back(value);
        } else {
            *position = value;
        }
    }
    return tails.size();
}
```

`tails` 不一定是原数组中的一条真实子序列；它保存的是各长度最有潜力的末尾。若要求恢复具体路径，需要额外记录前驱。

严格递增用 `lower_bound`；允许相等的非递减序列通常用 `upper_bound`。

## 12.4 编辑距离

令 `dp[i][j]` 表示字符串 `a` 的前 `i` 个字符变为 `b` 的前 `j` 个字符的最少操作数。

```text
若 a[i - 1] == b[j - 1]:
    dp[i][j] = dp[i - 1][j - 1]
否则:
    dp[i][j] = 1 + min(
        dp[i - 1][j],      // 删除
        dp[i][j - 1],      // 插入
        dp[i - 1][j - 1]   // 替换
    )
```

时间 `O(mn)`，空间可以从 `O(mn)` 压缩到 `O(min(m,n))`。若要恢复具体编辑序列，通常保留完整表或前驱信息。

## 12.5 DAG 上的动态规划

DAG 按拓扑序处理后，每条依赖边都从已完成状态指向未完成状态，因此可以做：

- 最长路径；
- 最短路径，即使边权为负也可以；
- 路径计数；
- 构建关键路径；
- 指令或任务依赖上的最早开始时间。

这类问题是动态规划与图算法的交叉点，也是编译器调度的基础。

## 12.6 常见 DP 类型

| 类型 | 典型状态 |
|---|---|
| 线性 DP | 前 `i` 个元素的答案 |
| 背包 DP | 前 `i` 件物品、容量 `c` |
| 区间 DP | 区间 `[left, right]` 的答案 |
| 树形 DP | 以节点为根的子树状态 |
| 状态压缩 DP | `mask` 表示已选择集合 |
| 数位 DP | 数字前缀、上界约束、前导零等状态 |
| 概率 DP | 到达状态的概率或期望 |

状态数量乘以每个状态的转移成本，通常就是时间复杂度。

---

# 13. 字符串算法

## 13.1 字符串首先是编码问题

C/C++ 中常见对象含义不同：

- C 字符串：以 `\0` 结尾的字节序列；
- `std::string`：拥有一段字节，可包含内部 `\0`；
- `std::string_view`：不拥有数据，底层对象失效后会悬空；
- UTF-8：变长编码，`size()` 返回字节数而非用户可见字符数。

题目中的“字符”需要明确是 ASCII 字节、Unicode code point 还是用户可见 grapheme cluster。

## 13.2 KMP

KMP 使用前缀函数避免失配后重复比较。`prefix[i]` 表示 `pattern[0..i]` 的最长真前缀与真后缀的公共长度。

```cpp
#include <string_view>
#include <vector>

std::vector<std::size_t> prefix_function(std::string_view pattern) {
    std::vector<std::size_t> prefix(pattern.size(), 0);
    for (std::size_t i = 1; i < pattern.size(); ++i) {
        std::size_t matched = prefix[i - 1];
        while (matched > 0 && pattern[i] != pattern[matched]) {
            matched = prefix[matched - 1];
        }
        if (pattern[i] == pattern[matched]) ++matched;
        prefix[i] = matched;
    }
    return prefix;
}

std::size_t kmp_find(std::string_view text, std::string_view pattern) {
    if (pattern.empty()) return 0;
    const auto prefix = prefix_function(pattern);
    std::size_t matched = 0;

    for (std::size_t i = 0; i < text.size(); ++i) {
        while (matched > 0 && text[i] != pattern[matched]) {
            matched = prefix[matched - 1];
        }
        if (text[i] == pattern[matched]) ++matched;
        if (matched == pattern.size()) {
            return i + 1 - pattern.size();
        }
    }
    return std::string_view::npos;
}
```

构造前缀函数和搜索都是线性时间。`matched` 在失配时沿着已知前后缀跳转，而不是让文本指针回退。

## 13.3 Rolling Hash

Rolling Hash 可以在 `O(1)` 时间比较子串哈希，常用于 Rabin-Karp、重复子串和字符串二分答案。

但哈希相等不代表字符串必然相等：

- 使用两个独立模数或 64 位自然溢出只能降低碰撞概率；
- 安全或严格正确场景要在哈希相等后比较原字符串；
- 模乘可能溢出，语言和整数类型必须明确。

## 13.4 进阶字符串结构

- Trie：前缀匹配；
- Aho-Corasick：多模式匹配；
- Z Algorithm：每个后缀与整个字符串的最长公共前缀；
- Manacher：线性求最长回文子串；
- 后缀数组：后缀排序、LCP 与子串问题；
- 后缀自动机：子串集合、出现次数与最长公共子串。

基础学习先掌握 KMP 和 Trie。只有内容涉及文本处理、编译器 lexer、存储引擎或算法竞赛时，再深入后几项。

---

# 14. 位运算与状态压缩

## 14.1 基本操作

```text
x & (1 << bit)       测试 bit
x | (1 << bit)       设置 bit
x & ~(1 << bit)      清除 bit
x ^ (1 << bit)       翻转 bit
x & (x - 1)          清除最低的一个 1
x & -x               取最低的一个 1（需明确补码和类型）
```

C/C++ 中建议对位运算使用无符号类型：

```cpp
#include <cstdint>

bool is_power_of_two(std::uint64_t value) {
    return value != 0 && (value & (value - 1)) == 0;
}
```

需要注意：

- 移位量不能大于等于类型位宽；
- 负有符号数右移的结果具有语言版本和实现语义背景，不能随意假设；
- 有符号左移溢出可能是未定义行为；
- `1 << bit` 中 `1` 是 `int`，处理 64 位掩码应写 `std::uint64_t{1} << bit`。

## 14.2 枚举子集

枚举 `mask` 的所有非空子集：

```cpp
#include <cstdint>

void visit_subsets(std::uint64_t mask) {
    for (std::uint64_t subset = mask; subset != 0;
         subset = (subset - 1) & mask) {
        consume(subset);
    }
}
```

子集数量是 `2^k`，其中 `k` 是 `mask` 中 1 的数量。代码短不代表复杂度低。

## 14.3 位图与 BitSet

如果 universe 是紧凑整数范围，位图通常比哈希集合更节省空间并具有更好的局部性：

```text
word = index / 64
bit  = index % 64
```

集合的交、并、差可以按 64 位 word 批量完成，并可使用 `popcount` 统计元素数。编译器中的活跃变量、可达定义和 dominance 集合经常使用位集合；更深入的实现见专业篇。

## 14.4 状态压缩 DP

当元素数量 `n` 较小，`mask` 可以表示一个子集。例如旅行商朴素状态：

```text
dp[mask][last]
= 访问集合为 mask，最后位于 last 的最小成本
```

状态数约 `O(2^n n)`，转移通常为 `O(n)`，因此整体 `O(2^n n^2)`。这只能处理较小 `n`，必须根据输入约束判断是否可行。

---

# 15. Fenwick Tree 与 Segment Tree

这两类结构并非所有项目都会用到，但它们能训练“动态维护区间信息”的能力。

## 15.1 Fenwick Tree

Fenwick Tree 支持：

- 单点增加：`O(log n)`；
- 前缀和：`O(log n)`；
- 区间和：两个前缀和相减；
- 空间：`O(n)`。

```cpp
#include <stdexcept>
#include <vector>

class FenwickTree {
public:
    explicit FenwickTree(std::size_t size) : tree_(size + 1, 0) {}

    void add(std::size_t index, long long delta) {
        if (index >= size()) throw std::out_of_range("Fenwick index");
        for (std::size_t i = index + 1; i < tree_.size(); i += lowbit(i)) {
            tree_[i] += delta;
        }
    }

    long long prefix_sum(std::size_t end) const {
        // 返回半开区间 [0, end) 的和，end 允许等于 size()。
        if (end > size()) throw std::out_of_range("Fenwick prefix");
        long long result = 0;
        for (std::size_t i = end; i > 0; i -= lowbit(i)) {
            result += tree_[i];
        }
        return result;
    }

    long long range_sum(std::size_t first, std::size_t last) const {
        if (first > last || last > size()) {
            throw std::out_of_range("Fenwick range");
        }
        return prefix_sum(last) - prefix_sum(first);
    }

    std::size_t size() const noexcept { return tree_.size() - 1; }

private:
    static std::size_t lowbit(std::size_t value) noexcept {
        return value & (~value + 1);
    }

    std::vector<long long> tree_;
};
```

内部使用一开始下标，`lowbit(i)` 表示节点负责的区间长度。

## 15.2 Segment Tree

Segment Tree 更通用：

- 区间查询、单点更新 `O(log n)`；
- 配合 lazy propagation 支持区间更新；
- 聚合运算需要满足结合律，例如 sum、min、max、gcd；
- 节点合并规则与单位元共同构成 monoid 结构。

如果数据静态不更新，前缀和或 Sparse Table 通常更简单；如果只需要前缀可加信息，Fenwick Tree 常数更小。

---

# 16. C/C++ 实现中的正确性陷阱

算法思路正确，不代表实现正确。系统代码尤其需要关注语言边界。

## 16.1 整数溢出

```cpp
int middle = (left + right) / 2; // left + right 可能溢出
int safe_middle = left + (right - left) / 2;
```

但第二种写法也要求 `right - left` 合法。求和、距离、边权和、面积通常应提升到 `std::int64_t` 或更宽类型后再计算。

有符号整数溢出在 C/C++ 中是未定义行为；无符号整数按模 `2^N` 回绕，但这不等于业务逻辑正确。

## 16.2 有符号与无符号混用

```cpp
for (std::size_t i = values.size() - 1; i >= 0; --i) {
    // 错误：i 永远不会小于 0，空数组还会先下溢。
}
```

反向遍历可以写：

```cpp
for (std::size_t i = values.size(); i-- > 0;) {
    consume(values[i]);
}
```

或者在确认长度可表示后使用有符号索引。

## 16.3 边界与区间约定

推荐统一使用半开区间 `[first, last)`：

- 长度是 `last - first`；
- 空区间满足 `first == last`；
- 相邻区间 `[a, b)` 与 `[b, c)` 无重叠；
- 与 STL 迭代器约定一致。

若题目使用闭区间，应在变量名或注释中明确，不要在同一函数混用。

## 16.4 生命周期与失效

- `vector` 扩容后旧指针、引用和迭代器可能失效；
- 容器擦除后不能继续解引用被擦除迭代器；
- `string_view`、`span` 不拥有数据；
- 递归或容器中保存裸节点指针时，要明确谁释放节点；
- 返回局部数组或局部对象地址会悬空。

## 16.5 比较器必须满足严格弱序

错误写法：

```cpp
[](int a, int b) { return a <= b; }
```

相等时也返回 true，违反非自反性，传给 `std::sort` 会导致未定义行为。应写 `a < b`，复合键使用清晰的字典序。

C 的 `qsort` 比较器也不能用 `return a - b`，因为减法可能溢出：

```c
int compare_int(const void *lhs, const void *rhs) {
    const int a = *(const int *)lhs;
    const int b = *(const int *)rhs;
    return (a > b) - (a < b);
}
```

## 16.6 深递归与内存上限

- 链状图上的递归 DFS 深度可能达到 `V`；
- 大型二维 DP 的空间可能先于时间成为瓶颈；
- `vector<vector<T>>` 不是一块完整二维连续内存；
- `n * m` 在分配前就可能发生整数溢出；
- 输入规模来自外部时必须设置资源上限。

## 16.7 不要把非法输入静默当成正常答案

示例代码有时用空容器或 `0` 表示非法输入，只为突出算法。真实接口应选择明确策略：

- 构造时维持不变量；
- 返回 `std::optional` / `std::expected`；
- 抛出有语义的异常；
- 返回错误码；
- 对内部不可能条件使用断言。

策略应与项目的异常、ABI 和实时性要求一致。

---

# 17. 解题与实现流程

## 17.1 先澄清约束

至少确认：

- 输入规模多大；
- 是否有序、是否允许重复；
- 是否允许修改输入；
- 空输入如何定义；
- 数值范围和溢出风险；
- 要返回一个答案、全部答案还是数量；
- 是一次查询还是大量在线查询；
- 时间和内存哪个更受限；
- 是否存在并发、流式或外存约束。

约束决定算法。`n <= 20` 可能允许状态压缩，`n <= 10^5` 常要求 `O(n log n)`，`n` 达到十亿则通常不能逐元素处理。

## 17.2 从直接解法开始

推荐表达顺序：

```text
直接解法是什么
→ 重复工作在哪里
→ 用什么信息避免重复
→ 为什么新数据结构能维护该信息
→ 新复杂度与额外空间是什么
```

这样即使没有推到最优解，也能展示分析过程；直接跳到背诵模板反而容易在追问中失去解释能力。

## 17.3 写代码前先说不变量

示例：二分查找。

> 我维护半开区间 `[first, last)`。它左边全部不满足条件，右边全部满足条件；循环每次至少缩小一个元素，结束时 `first == last`，就是第一个满足条件的位置。

不变量能同时帮助证明正确性和避免边界错误。

## 17.4 主动测试

通用测试集：

- 空输入；
- 单元素；
- 两个元素；
- 全部相同；
- 已有序、逆序；
- 答案在开头或结尾；
- 没有答案；
- 多个合法答案；
- 负数、零、整数极值；
- 极深结构和最大规模。

图算法还要测试：孤立点、自环、重边、不连通、环、非法顶点编号。字符串要测试空模式和编码边界。

## 17.5 复杂度和工程追问

完成后继续检查：

- 最坏、平均还是均摊复杂度；
- 额外空间是否包含输出；
- 输入规模放大十倍会怎样；
- 缓存局部性如何；
- 能否并行；
- 若内存不足能否流式或外排；
- 若数据并发修改，算法假设是否仍成立；
- 是否存在 UB、栈溢出和迭代器失效。