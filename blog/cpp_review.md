# 1. C++ 核心问题

1. 对象什么时候构造、什么时候析构。
2. 资源由谁拥有，什么时候释放。
3. 拷贝、移动、引用、指针之间的语义差异。
4. STL 容器的底层结构和迭代器失效规则。
5. 模板、SFINAE、concepts 等泛型机制。
6. 并发中的数据竞争、死锁、条件变量、内存序。
7. 编译链接、ODR、ABI、动态库兼容。
8. 性能优化中的缓存、分配、拷贝、锁竞争。

---

# 2. const、constexpr、consteval、constinit

## 2.1 const

`const` 表示对象初始化后不能通过该名字修改。

```cpp
const int x = 10;
// x = 20; // error
```

但注意：

```cpp
int a = 10;
const int* p = &a; // 不能通过 p 修改 a
a = 20;            // 但 a 本身仍然能被修改
```

`const` 不是一定代表编译期常量。

```cpp
int f();

const int a = 10;  // 编译期常量
const int b = f(); // 运行期常量
```

`a` 可以用于要求编译期常量的场景，`b` 不行。

---

## 2.2 constexpr

`constexpr` 表示这个变量或函数可以参与编译期求值。

```cpp
constexpr int x = 10;
int arr[x]; // OK
```

函数也可以是 `constexpr`：

```cpp
constexpr int square(int x) {
    return x * x;
}

constexpr int y = square(5); // 编译期计算
```

但 `constexpr` 函数不一定每次都在编译期执行。

```cpp
int n;
std::cin >> n;
int r = square(n); // 运行期执行
```

重点：

> constexpr 表示“允许编译期求值”，不是“强制编译期求值”。

---

## 2.3 consteval

`consteval` 是 C++20 引入的，表示函数必须在编译期执行。

```cpp
consteval int square(int x) {
    return x * x;
}

constexpr int a = square(5); // OK

int n = 5;
// int b = square(n); // error，n 不是编译期常量
```



> constexpr 是可以编译期执行，consteval 是必须编译期执行。

---

## 2.4 constinit

`constinit` 是 C++20 引入的，用来保证变量进行静态初始化，而不是动态初始化。

```cpp
constinit int x = 10; // OK

int f();
// constinit int y = f(); // error，不能保证编译期初始化
```

它主要用于全局变量或静态变量，避免“静态初始化顺序问题”。

```cpp
constinit static int counter = 0;
```

注意：

`constinit` 不表示变量不可修改。

```cpp
constinit int x = 10;
x = 20; // OK
```

---

## 2.5 总结

| 关键字    | 核心含义               | 是否不可修改 |     是否必须编译期 |
| --------- | ---------------------- | -----------: | -----------------: |
| const     | 对象不可通过该名字修改 |           是 |                 否 |
| constexpr | 可用于编译期求值       |       通常是 |     是，用于变量时 |
| consteval | 函数必须编译期执行     |   不直接相关 |                 是 |
| constinit | 保证静态初始化         |           否 | 初始化必须静态完成 |

---

# 3. 指针、引用和值语义

## 3.1 指针和引用的区别

引用是对象的别名：

```cpp
int x = 10;
int& r = x;
r = 20; // 修改 x
```

指针是保存地址的对象：

```cpp
int x = 10;
int* p = &x;
*p = 20; // 修改 x
```

| 维度           | 指针                               | 引用                             |
| -------------- | ---------------------------------- | -------------------------------- |
| 是否可为空     | 可以为 nullptr                     | 正常情况下不为空                 |
| 是否必须初始化 | 不必须                             | 必须                             |
| 是否可重新绑定 | 可以                               | 不可以                           |
| 是否占空间     | 指针对象通常占空间                 | 实现上可能占空间，但语义上是别名 |
| 传参语义       | 指针本身按值传递                   | 直接绑定实参                     |
| 常见用途       | 可选对象、数组、动态资源、底层结构 | 参数传递、返回别名、重载操作符   |

---

## 3.2 引用不等于“永远安全”

下面代码错误：

```cpp
int& getRef() {
    int x = 10;
    return x;
}
```

`x` 是局部变量，函数返回后生命周期结束。返回它的引用会产生悬垂引用。

```cpp
int* getPtr() {
    int x = 20;
    return &x;
}
```

同理，返回局部变量地址会产生悬垂指针。

正确方式：

```cpp
int getValue() {
    int x = 10;
    return x; // 返回值安全
}
```

或者返回静态对象引用，但要注意线程安全和全局状态问题：

```cpp
int& getStaticRef() {
    static int x = 10;
    return x;
}
```

---

## 3.3 const 指针组合

```cpp
int* p1;              // 指向 int 的指针
const int* p2;        // 指向 const int 的指针，不能通过 p2 改值
int* const p3 = &x;   // const 指针，p3 不能改指向
const int* const p4;  // 指针本身不能改，指向的值也不能通过它改
```

记忆方式：

> const 修饰它左边的东西；如果左边没有东西，就修饰右边的东西。

```cpp
const int* p;
// const 修饰 int

int* const p = &x;
// const 修饰 p
```

---

# 4. 左值、右值、移动语义

## 4.1 值类别

C++ 表达式有值类别。常见的有：

1. lvalue，左值。
2. prvalue，纯右值。
3. xvalue，将亡值。
4. glvalue，广义左值。
5. rvalue，右值，包括 prvalue 和 xvalue。



| 类别           | 含义             | 例子                   |
| -------------- | ---------------- | ---------------------- |
| 左值 lvalue    | 有身份、可取地址 | 变量名、引用返回       |
| 纯右值 prvalue | 临时值           | `42`、`x + 1`、`T{}`   |
| 将亡值 xvalue  | 即将被移动的对象 | `std::move(x)`         |
| 右值 rvalue    | prvalue + xvalue | 临时值、std::move 结果 |

---

## 4.2 变量名永远是左值表达式

```cpp
int&& rr = 10;
```

`rr` 的类型是右值引用，但表达式 `rr` 是左值。

```cpp
void f(int&& x) {
    g(x);            // x 是左值
    g(std::move(x)); // x 被转成右值
}
```

高频点：

> 右值引用变量本身是一个有名字的变量，所以表达式是左值。

---

## 4.3 std::move 的本质

`std::move` 不移动任何东西。

它只是一个类型转换：

```cpp
template <class T>
constexpr remove_reference_t<T>&& move(T&& t) noexcept;
```

本质：

```cpp
static_cast<T&&>(t)
```

例子：

```cpp
std::string s = "hello";
std::string t = std::move(s);
```

真正移动发生在 `std::string` 的移动构造函数里，不是发生在 `std::move` 里。



> std::move 只是把表达式转换成右值，让移动构造或移动赋值有机会被调用。

---

## 4.4 移动后的对象还能用吗？

可以析构，可以赋新值，可以调用没有前置条件的函数，但不要假设它原来的值。

```cpp
std::string s = "hello";
std::string t = std::move(s);

s = "world"; // OK
```

移动后对象处于：

> valid but unspecified state  
> 有效但值未指定的状态。

---

# 5. 对象生命周期与特殊成员函数

## 5.1 六大特殊成员函数

C++ 中常说的特殊成员函数包括：

```cpp
class A {
public:
    A();                         // 默认构造
    ~A();                        // 析构
    A(const A&);                 // 拷贝构造
    A& operator=(const A&);      // 拷贝赋值
    A(A&&) noexcept;             // 移动构造
    A& operator=(A&&) noexcept;  // 移动赋值
};
```

它们分别对应：

| 函数     | 场景                     |
| -------- | ------------------------ |
| 默认构造 | 创建对象                 |
| 析构函数 | 销毁对象                 |
| 拷贝构造 | 用已有对象初始化新对象   |
| 拷贝赋值 | 已存在对象之间赋值       |
| 移动构造 | 用右值初始化新对象       |
| 移动赋值 | 已存在对象从右值接管资源 |

---

## 5.2 初始化不是赋值

高频易错点：

```cpp
A b = a;
```

这是拷贝构造，不是拷贝赋值。

```cpp
A b;
b = a;
```

这才是拷贝赋值。

类似：

```cpp
A c = std::move(a);
```

这是移动构造，不是移动赋值。

```cpp
A c;
c = std::move(a);
```

这才是移动赋值。

---

## 5.3 拷贝省略

C++17 之后，某些场景强制拷贝省略：

```cpp
T make() {
    return T{};
}

T x = make();
```

这里通常不会发生移动或拷贝，直接在目标对象位置构造。

NRVO：

```cpp
T make() {
    T t;
    return t;
}
```

这叫 Named Return Value Optimization。编译器通常会优化掉拷贝/移动，但不是所有情况下强制。

---

# 6. Rule of Three / Five / Zero

## 6.1 Rule of Three

如果一个类需要自己写以下任意一个：

1. 析构函数
2. 拷贝构造
3. 拷贝赋值

通常就需要同时考虑另外两个。

原因是：类大概率管理了资源。

错误例子：

```cpp
class Buffer {
public:
    Buffer(size_t n) : data_(new char[n]) {}
    ~Buffer() { delete[] data_; }

private:
    char* data_;
};
```

默认拷贝构造会浅拷贝指针：

```cpp
Buffer a(1024);
Buffer b = a; // a.data_ 和 b.data_ 指向同一块内存
```

最终会 double delete。

---

## 6.2 Rule of Five

C++11 加入移动语义后，如果类管理资源，通常要考虑五个函数：

```cpp
class Buffer {
public:
    Buffer(size_t n)
        : size_(n), data_(new char[n]) {}

    ~Buffer() {
        delete[] data_;
    }

    Buffer(const Buffer& other)
        : size_(other.size_), data_(new char[other.size_]) {
        std::copy(other.data_, other.data_ + size_, data_);
    }

    Buffer& operator=(const Buffer& other) {
        if (this == &other) {
            return *this;
        }

        char* new_data = new char[other.size_];
        std::copy(other.data_, other.data_ + other.size_, new_data);

        delete[] data_;
        data_ = new_data;
        size_ = other.size_;

        return *this;
    }

    Buffer(Buffer&& other) noexcept
        : size_(other.size_), data_(other.data_) {
        other.size_ = 0;
        other.data_ = nullptr;
    }

    Buffer& operator=(Buffer&& other) noexcept {
        if (this == &other) {
            return *this;
        }

        delete[] data_;

        size_ = other.size_;
        data_ = other.data_;

        other.size_ = 0;
        other.data_ = nullptr;

        return *this;
    }

private:
    size_t size_{0};
    char* data_{nullptr};
};
```

关键点：

1. 拷贝构造要深拷贝。
2. 拷贝赋值要处理自赋值。
3. 移动构造要偷资源，并把源对象置空。
4. 移动赋值要先释放自己的旧资源，再接管新资源。
5. 移动操作通常要 `noexcept`。

---

## 6.3 Rule of Zero

现代 C++ 更推荐 Rule of Zero：

> 类本身不直接管理裸资源，而是交给标准库类型管理。

比如：

```cpp
class Buffer {
public:
    explicit Buffer(size_t n) : data_(n) {}

private:
    std::vector<char> data_;
};
```

这样不需要手写析构、拷贝、移动。



> 如果业务类只是组合标准库资源管理类型，就尽量不要手写特殊成员函数，让编译器生成正确版本。

---

# 7. RAII

## 7.1 RAII 是什么

RAII：Resource Acquisition Is Initialization。

中文常翻译为：

> 资源获取即初始化。

核心思想：

1. 在构造函数中获取资源。
2. 在析构函数中释放资源。
3. 利用对象生命周期自动管理资源。

例子：

```cpp
class File {
public:
    File(const char* path) {
        fp_ = std::fopen(path, "r");
        if (!fp_) {
            throw std::runtime_error("open file failed");
        }
    }

    ~File() {
        if (fp_) {
            std::fclose(fp_);
        }
    }

    File(const File&) = delete;
    File& operator=(const File&) = delete;

private:
    std::FILE* fp_;
};
```

---

## 7.2 RAII 管什么资源

不只是内存。

RAII 可以管理：

1. 堆内存。
2. 文件句柄。
3. socket。
4. mutex。
5. 数据库连接。
6. 线程。
7. GPU 资源。
8. 临时目录。
9. 日志上下文。
10. 事务回滚。

---

# 8. 智能指针

## 8.1 unique_ptr

`std::unique_ptr<T>` 表示独占所有权。

```cpp
std::unique_ptr<int> p = std::make_unique<int>(10);
```

特点：

1. 不能拷贝。
2. 可以移动。
3. 析构时自动 delete。
4. 几乎没有额外开销。

```cpp
std::unique_ptr<int> p1 = std::make_unique<int>(10);
// auto p2 = p1; // error

auto p2 = std::move(p1); // OK
```

适用场景：

1. 独占资源。
2. 工厂函数返回对象。
3. 多态对象所有权转移。

```cpp
std::unique_ptr<Base> create() {
    return std::make_unique<Derived>();
}
```

---

## 8.2 shared_ptr

`std::shared_ptr<T>` 表示共享所有权。

它内部通常包含：

1. 指向对象的指针。
2. 指向控制块的指针。

控制块通常包含：

1. 强引用计数。
2. 弱引用计数。
3. deleter。
4. allocator。
5. 可能的类型擦除信息。

```cpp
auto p1 = std::make_shared<int>(10);
auto p2 = p1; // 引用计数 +1
```

当最后一个 `shared_ptr` 被销毁，对象被释放。

---

## 8.3 weak_ptr

`std::weak_ptr<T>` 表示弱引用，不增加强引用计数。

主要用途：

1. 打破 shared_ptr 循环引用。
2. 缓存对象但不拥有对象。
3. 观察对象是否还活着。

```cpp
std::weak_ptr<int> wp;

{
    auto sp = std::make_shared<int>(10);
    wp = sp;
}

if (auto sp = wp.lock()) {
    // 对象还活着
} else {
    // 对象已销毁
}
```

---

## 8.4 shared_ptr 循环引用

错误例子：

```cpp
struct Node {
    std::shared_ptr<Node> next;
    std::shared_ptr<Node> prev;
};
```

```cpp
auto a = std::make_shared<Node>();
auto b = std::make_shared<Node>();

a->next = b;
b->prev = a;
```

`a` 和 `b` 互相持有，引用计数永远不为 0。

修复：

```cpp
struct Node {
    std::shared_ptr<Node> next;
    std::weak_ptr<Node> prev;
};
```

一般规则：

> 拥有关系用 shared_ptr，非拥有观察关系用 weak_ptr。

---

## 8.5 make_shared 和 shared_ptr(new T)

推荐：

```cpp
auto p = std::make_shared<T>();
```

不推荐：

```cpp
std::shared_ptr<T> p(new T);
```

原因：

1. `make_shared` 通常一次分配对象和控制块。
2. `shared_ptr(new T)` 通常对象和控制块分两次分配。
3. `make_shared` 异常安全更好。
4. `make_shared` 缓存局部性更好。

但 `make_shared` 也有注意点：

如果存在 `weak_ptr`，即使对象已销毁，控制块还在。如果对象和控制块一次分配，整块内存可能要等 weak_ptr 全部销毁后才释放。

---

## 8.6 shared_ptr 不能从同一个裸指针构造两次

严重错误：

```cpp
int* raw = new int(10);

std::shared_ptr<int> p1(raw);
std::shared_ptr<int> p2(raw);
```

这里会产生两个控制块。

结果：

1. p1 认为自己拥有 raw。
2. p2 也认为自己拥有 raw。
3. 最后会 delete 两次。
4. 产生未定义行为。

正确：

```cpp
auto p1 = std::make_shared<int>(10);
auto p2 = p1;
```

---

## 8.7 enable_shared_from_this

错误例子：

```cpp
class A {
public:
    std::shared_ptr<A> getPtr() {
        return std::shared_ptr<A>(this);
    }
};
```

这会创建新的控制块，非常危险。

正确写法：

```cpp
class A : public std::enable_shared_from_this<A> {
public:
    std::shared_ptr<A> getPtr() {
        return shared_from_this();
    }
};
```

使用注意：

```cpp
auto p = std::make_shared<A>();
auto q = p->getPtr(); // OK
```

不能在对象还没有被 `shared_ptr` 管理时调用：

```cpp
A a;
// a.getPtr(); // error，可能抛 std::bad_weak_ptr
```

也不要在构造函数中调用 `shared_from_this()`，因为此时 shared_ptr 控制块还没有完全建立。

---

# 9. new/delete 与 malloc/free

## 9.1 区别

| 项目     | new/delete        | malloc/free                    |
| -------- | ----------------- | ------------------------------ |
| 语言     | C++ 运算符        | C 库函数                       |
| 构造函数 | new 调用          | malloc 不调用                  |
| 析构函数 | delete 调用       | free 不调用                    |
| 返回类型 | 有类型            | void*                          |
| 失败行为 | 抛 std::bad_alloc | 返回 nullptr                   |
| 可重载   | 可以              | 不可以像 operator new 那样重载 |

---

## 9.2 数组必须 delete[]

错误：

```cpp
int* p = new int[10];
delete p; // wrong
```

正确：

```cpp
delete[] p;
```

因为 `new[]` 和 `delete[]` 必须配对。

---

## 9.3 malloc 不构造对象

错误：

```cpp
A* p = static_cast<A*>(std::malloc(sizeof(A)));
std::free(p);
```

这不会调用构造和析构。

如果确实要在已分配内存上构造对象，要使用 placement new：

```cpp
void* mem = std::malloc(sizeof(A));
A* p = new (mem) A();

p->~A();
std::free(mem);
```

---

# 10. 虚函数、虚表、多态

## 10.1 虚函数实现原理

典型实现：

1. 含虚函数的类有虚表 vtable。
2. 对象中有虚指针 vptr。
3. vptr 指向该对象实际类型对应的虚表。
4. 调用虚函数时，通过 vptr 找到虚表，再找到函数地址。

```cpp
Base* p = new Derived();
p->foo(); // 动态绑定，调用 Derived::foo
```

---

## 10.2 为什么基类析构函数要 virtual

错误：

```cpp
class Base {
public:
    ~Base() {}
};

class Derived : public Base {
public:
    ~Derived() {}
};

Base* p = new Derived();
delete p; // UB
```

如果通过基类指针删除派生类对象，而基类析构函数不是 virtual，会产生未定义行为。

正确：

```cpp
class Base {
public:
    virtual ~Base() = default;
};
```



> 只要一个类打算作为多态基类使用，就应该给它 virtual 析构函数。

---

## 10.3 构造函数不能是 virtual

原因：

1. 构造对象时，对象还没有完全形成。
2. 虚函数依赖对象的动态类型。
3. 构造函数负责建立对象，包括 vptr。
4. 所以构造函数不能虚。

---

## 10.4 析构函数可以 virtual

析构函数可以是虚函数，而且多态基类通常必须是虚析构。

```cpp
class Base {
public:
    virtual ~Base() = default;
};
```

---

# 11. 构造析构中的虚函数行为

高频陷阱：

```cpp
class Base {
public:
    Base() { foo(); }
    virtual ~Base() { foo(); }

    virtual void foo() {
        std::cout << "Base::foo\n";
    }
};

class Derived : public Base {
public:
    void foo() override {
        std::cout << "Derived::foo\n";
    }
};

Derived d;
```

输出：

```text
Base::foo
Base::foo
```

原因：

1. 构造 Base 部分时，Derived 部分还没构造完成。
2. 析构 Base 部分时，Derived 部分已经析构完成。
3. 所以在 Base 构造/析构中调用虚函数，不会动态派发到 Derived。

结论：

> 构造和析构函数中调用虚函数，调用的是当前正在构造或析构的类版本，不会调用派生类版本。

---

# 12. 重载、重写、隐藏

## 12.1 overload

重载发生在同一作用域，函数名相同，参数不同。

```cpp
void f(int);
void f(double);
```

---

## 12.2 override

重写发生在继承体系中：

```cpp
class Base {
public:
    virtual void f(int);
};

class Derived : public Base {
public:
    void f(int) override;
};
```

推荐永远写 `override`，让编译器帮你检查。

---

## 12.3 name hiding

派生类中声明同名函数，会隐藏基类所有同名函数。

```cpp
class Base {
public:
    virtual void foo(int);
};

class Derived : public Base {
public:
    void foo(double);
};
```

此时：

```cpp
Derived d;
d.foo(1); // 调用 Derived::foo(double)
```

`Base::foo(int)` 被隐藏了。

修复：

```cpp
class Derived : public Base {
public:
    using Base::foo;

    void foo(double);
};
```

---

# 13. 对象模型与内存布局

## 13.1 类对象大小由什么决定

影响因素：

1. 非静态数据成员。
2. 基类子对象。
3. 虚函数带来的 vptr。
4. 虚继承带来的额外指针或偏移信息。
5. 内存对齐和 padding。
6. 空类大小。
7. `[[no_unique_address]]`。
8. 编译器 ABI。

不影响每个对象大小的通常有：

1. 静态成员变量。
2. 普通成员函数。
3. 静态成员函数。
4. 非虚函数代码。

---

## 13.2 空类大小

```cpp
struct A {};
```

空类大小通常是 1。

原因：

> C++ 要求不同对象有不同地址，所以空对象也必须占至少 1 字节。

```cpp
A a1, a2;
assert(&a1 != &a2);
```

---

## 13.3 空基类优化 EBO

```cpp
struct Empty {};

struct X : Empty {
    int value;
};
```

`sizeof(X)` 通常是 4，不是 5 或 8。

因为编译器可以对空基类做 Empty Base Optimization。

---

## 13.4 对齐示例

```cpp
struct S {
    char a;
    int b;
    char c;
};
```

在 64 位系统常见布局：

```text
a: 1
padding: 3
b: 4
c: 1
tail padding: 3
total: 12
```

优化：

```cpp
struct S {
    int b;
    char a;
    char c;
};
```

布局：

```text
b: 4
a: 1
c: 1
tail padding: 2
total: 8
```

---

# 14. STL 容器：vector、deque、list

## 14.1 vector

底层：连续动态数组。

优点：

1. 随机访问 O(1)。
2. 尾部插入均摊 O(1)。
3. 缓存友好。
4. 内存开销小。

缺点：

1. 中间插入删除 O(n)。
2. 扩容会搬迁元素。
3. 扩容导致迭代器、指针、引用失效。

---

## 14.2 list

底层：双向链表。

优点：

1. 已知位置插入删除 O(1)。
2. 插入删除通常不影响其他元素迭代器。

缺点：

1. 不支持随机访问。
2. 每个节点额外存前后指针。
3. 缓存不友好。
4. 实际遍历性能通常差。

---

## 14.3 deque

底层：分段连续数组。

优点：

1. 支持随机访问。
2. 头尾插入删除 O(1)。
3. 比 vector 更适合双端队列。

缺点：

1. 不完全连续。
2. 中间插入删除代价高。
3. 迭代器结构更复杂。
4. 缓存局部性通常不如 vector。

---

## 14.4 vector 扩容

当 size 达到 capacity，再插入元素时：

1. 分配更大内存。
2. 将旧元素移动或拷贝到新内存。
3. 析构旧元素。
4. 释放旧内存。
5. 插入新元素。

为什么按倍数增长？

因为可以保证尾插均摊 O(1)。

如果每次只增长一个元素，则连续 push_back n 次会变成 O(n²)。

---

## 14.5 vector 扩容时移动还是拷贝

如果类型的移动构造是 `noexcept`，vector 通常优先移动。

```cpp
struct A {
    A(A&&) noexcept;
};
```

如果移动构造可能抛异常，而拷贝构造可用，vector 可能选择拷贝，以保证异常安全。

因此：

> 移动构造函数应该尽量标记为 noexcept。

---

# 15. map 与 unordered_map

## 15.1 map

`std::map` 通常基于红黑树。

特点：

1. key 有序。
2. 查找 O(log n)。
3. 插入 O(log n)。
4. 删除 O(log n)。
5. 迭代器稳定性好。
6. 支持范围查询。

适合：

1. 需要按 key 有序遍历。
2. 需要 lower_bound / upper_bound。
3. 对最坏复杂度敏感。

---

## 15.2 unordered_map

`std::unordered_map` 基于哈希表。

特点：

1. key 无序。
2. 平均查找 O(1)。
3. 最坏查找 O(n)。
4. rehash 会导致迭代器失效。
5. 需要 hash 和相等比较。

适合：

1. 高频查找。
2. 不要求顺序。
3. key 哈希质量较好。

---

## 15.3 自定义 key

```cpp
struct Point {
    int x;
    int y;

    bool operator==(const Point& other) const {
        return x == other.x && y == other.y;
    }
};

struct PointHash {
    std::size_t operator()(const Point& p) const {
        std::size_t h1 = std::hash<int>{}(p.x);
        std::size_t h2 = std::hash<int>{}(p.y);
        return h1 ^ (h2 << 1);
    }
};

std::unordered_map<Point, int, PointHash> mp;
```

需要：

1. hash 函数。
2. 相等比较。

---

# 16. 迭代器失效

## 16.1 vector

`push_back`：

1. 如果不扩容，end 迭代器失效。
2. 如果扩容，所有迭代器、引用、指针失效。

`erase`：

1. 被删元素及其之后的迭代器失效。
2. 返回下一个有效迭代器。

正确删除：

```cpp
for (auto it = v.begin(); it != v.end(); ) {
    if (*it == 3) {
        it = v.erase(it);
    } else {
        ++it;
    }
}
```

---

## 16.2 list

插入删除不会影响其他元素的迭代器。

删除元素本身的迭代器失效。

---

## 16.3 map

插入通常不影响已有迭代器。

删除只影响被删元素的迭代器。

---

## 16.4 unordered_map

插入可能触发 rehash。

rehash 会导致所有迭代器失效。

删除只使被删除元素迭代器失效。

引用和指针在 rehash 后通常仍指向元素对象，但不要依赖复杂场景下的实现细节，“迭代器会失效”。

---

## 16.5 deque

deque 规则复杂：

1. 头尾插入可能导致迭代器失效。
2. 中间插入删除通常导致迭代器失效。
3. 删除元素会影响相关位置。
4. 引用失效规则和迭代器不完全一样。



> deque 的迭代器失效规则比 vector/list 复杂，尤其头尾和中间操作不同，实际编码时要谨慎使用操作返回值，不要保留旧迭代器。

---

# 17. STL 算法与 lambda

## 17.1 remove 不是真删除

```cpp
std::remove(v.begin(), v.end(), 3);
```

`remove` 只是把不删除的元素往前移动，返回新的逻辑末尾。

正确：

```cpp
v.erase(std::remove(v.begin(), v.end(), 3), v.end());
```

这叫 erase-remove idiom。

C++20 可以：

```cpp
std::erase(v, 3);
```

---

## 17.2 lambda 捕获

```cpp
[=]     // 默认按值捕获用到的局部变量
[&]     // 默认按引用捕获用到的局部变量
[x]     // 按值捕获 x
[&x]    // 按引用捕获 x
[this]  // 捕获 this 指针
[*this] // C++17，按值捕获当前对象副本
```

危险例子：

```cpp
std::function<int()> makeFunc() {
    int x = 10;
    return [&]() {
        return x;
    };
}
```

返回后 x 已销毁，lambda 中引用悬垂。

正确：

```cpp
std::function<int()> makeFunc() {
    int x = 10;
    return [x]() {
        return x;
    };
}
```

---

## 17.3 捕获 this 的风险

```cpp
class A {
public:
    std::function<void()> f() {
        return [this] {
            use();
        };
    }

    void use() {}
};
```

如果 lambda 执行时对象已销毁，`this` 悬垂。

可改为：

```cpp
class A : public std::enable_shared_from_this<A> {
public:
    std::function<void()> f() {
        std::weak_ptr<A> wp = shared_from_this();

        return [wp] {
            if (auto sp = wp.lock()) {
                sp->use();
            }
        };
    }

    void use() {}
};
```

---

# 18. 模板基础

## 18.1 模板什么时候实例化

模板不是普通函数。模板本身是生成代码的蓝图。

```cpp
template <typename T>
T add(T a, T b) {
    return a + b;
}
```

当使用时：

```cpp
add<int>(1, 2);
add<double>(1.0, 2.0);
```

编译器为不同类型实例化不同版本。

---

## 18.2 为什么模板通常放头文件

因为编译器实例化模板时需要看到完整定义。

如果只有声明：

```cpp
template <typename T>
T add(T a, T b);
```

调用处无法实例化实现。

所以模板通常写在头文件里。

例外：显式实例化。

```cpp
template int add<int>(int, int);
```

---

## 18.3 模板特化

通用模板：

```cpp
template <typename T>
struct TypeName {
    static constexpr const char* value = "unknown";
};
```

全特化：

```cpp
template <>
struct TypeName<int> {
    static constexpr const char* value = "int";
};
```

偏特化：

```cpp
template <typename T>
struct TypeName<T*> {
    static constexpr const char* value = "pointer";
};
```

函数模板不能偏特化，只能重载或全特化。

---

# 19. 完美转发、万能引用、引用折叠

## 19.1 万能引用 / 转发引用

```cpp
template <typename T>
void f(T&& x);
```

这里 `T&&` 在模板参数推导场景下是 forwarding reference。

如果传左值：

```cpp
int a = 10;
f(a);
```

T 推导为 `int&`，`T&&` 折叠为 `int&`。

如果传右值：

```cpp
f(10);
```

T 推导为 `int`，`T&&` 是 `int&&`。

---

## 19.2 引用折叠规则

核心规则：

```text
&  + &  -> &
&  + && -> &
&& + &  -> &
&& + && -> &&
```

只要有一个是左值引用，结果就是左值引用。

---

## 19.3 std::forward 与 std::move

`std::move(x)`：

> 无条件把 x 转为右值。

`std::forward<T>(x)`：

> 有条件转发，保留原始实参的左值/右值属性。

错误包装：

```cpp
template <typename T>
void wrapper(T&& arg) {
    process(arg); // arg 有名字，是左值
}
```

正确：

```cpp
template <typename T>
void wrapper(T&& arg) {
    process(std::forward<T>(arg));
}
```

---

## 19.4 emplace_back 是否一定更快

```cpp
v.push_back(T(args...));
v.emplace_back(args...);
```

`emplace_back` 可以在容器内部直接构造对象，避免临时对象。

但不一定更快：

1. 如果传入的本来就是 T 对象，push_back(std::move(obj)) 很清晰。
2. 编译器可能消除临时对象。
3. emplace_back 可能调用意外的构造函数。
4. 可读性有时不如 push_back。

建议：

```cpp
v.emplace_back(arg1, arg2);    // 需要原地构造
v.push_back(std::move(obj));   // 已经有对象
```

---

# 20. SFINAE、type traits、concepts

## 20.1 SFINAE 是什么

SFINAE：Substitution Failure Is Not An Error。

意思是：

> 模板替换失败不是编译错误，而是从候选集中移除该模板。

例子：

```cpp
template <typename T>
auto has_size_impl(int) -> decltype(std::declval<T>().size(), std::true_type{});

template <typename T>
std::false_type has_size_impl(...);

template <typename T>
using has_size = decltype(has_size_impl<T>(0));
```

意图：

1. 优先匹配第一个函数。
2. 如果 `T` 有 `.size()`，第一个函数合法，返回 true_type。
3. 如果 `T` 没有 `.size()`，替换失败，不报错，选择第二个函数，返回 false_type。

---

## 20.2 enable_if

```cpp
template <typename T>
std::enable_if_t<std::is_integral_v<T>, void>
print(T x) {
    std::cout << "integer\n";
}
```

只有当 `T` 是整数类型时，这个模板才参与重载决议。

---

## 20.3 if constexpr

C++17 更推荐：

```cpp
template <typename T>
void print(const T& x) {
    if constexpr (std::is_integral_v<T>) {
        std::cout << "integer\n";
    } else {
        std::cout << "other\n";
    }
}
```

`if constexpr` 不满足的分支不会实例化。

---

## 20.4 concepts

C++20 concepts：

```cpp
template <typename T>
concept HasSize = requires(T t) {
    t.size();
};

template <HasSize T>
void print_size(const T& t) {
    std::cout << t.size() << '\n';
}
```

优势：

1. 语义清楚。
2. 错误信息更好。
3. 约束直接写在接口上。
4. 替代复杂 SFINAE。



> concepts 是对模板参数能力的显式约束，使泛型代码更可读、更容易诊断错误。

---

# 21. 异常安全与 noexcept

## 21.1 C++ 异常 vs 错误码

异常优点：

1. 错误处理和正常逻辑分离。
2. 可以跨多层调用传播错误。
3. 构造函数失败只能靠异常自然表达。
4. 配合 RAII 可以自动清理资源。

异常缺点：

1. 控制流不直观。
2. ABI 和性能模型更复杂。
3. 不适合某些实时系统。
4. 析构中处理不当会导致 terminate。

错误码优点：

1. 控制流明确。
2. ABI 简单。
3. 常用于系统编程和 C 接口。

错误码缺点：

1. 容易忘记检查。
2. 错误处理代码侵入主逻辑。
3. 构造函数表达失败不自然。

---

## 21.2 异常安全保证

### 基本保证

异常发生后，对象仍然保持有效状态，不泄漏资源，但值可能改变。

### 强保证

异常发生后，程序状态不变，就像操作没发生。

### 不抛保证

函数承诺不抛异常。

```cpp
void f() noexcept;
```

---

## 21.3 析构函数为什么不应该抛异常

如果异常传播过程中发生栈展开，局部对象会析构。

如果析构函数又抛异常，就会同时存在两个未处理异常，程序调用 `std::terminate()`。

所以析构函数应尽量 `noexcept`。

```cpp
~A() noexcept {
    try {
        cleanup();
    } catch (...) {
        // 记录日志，不能继续抛
    }
}
```

---

## 21.4 noexcept 的作用

`noexcept` 表示函数不会抛异常。

作用：

1. 文档化接口承诺。
2. 帮助编译器优化。
3. 影响 STL 容器选择移动还是拷贝。
4. 如果 noexcept 函数抛异常，调用 std::terminate。

---

## 21.5 移动构造为什么要 noexcept

vector 扩容时需要搬迁元素。

如果移动构造可能抛异常，vector 为了提供强异常安全保证，可能选择拷贝而不是移动。

```cpp
struct A {
    A(A&&) noexcept;
};
```

建议：

> 资源接管型移动构造一般不会抛异常，应标记 noexcept。

---

# 22. 并发基础：thread、mutex、lock

## 22.1 数据竞争

多个线程同时访问同一内存位置，至少一个是写，并且没有同步，就发生数据竞争。

数据竞争是未定义行为。

错误：

```cpp
int counter = 0;

void f() {
    ++counter;
}
```

多个线程同时执行会数据竞争。

修复：

```cpp
std::mutex m;
int counter = 0;

void f() {
    std::lock_guard<std::mutex> lock(m);
    ++counter;
}
```

或者：

```cpp
std::atomic<int> counter{0};

void f() {
    ++counter;
}
```

---

## 22.2 mutex 手动 lock/unlock 的问题

错误：

```cpp
m.lock();
doSomething();
m.unlock();
```

如果 `doSomething()` 抛异常，unlock 不会执行。

正确：

```cpp
std::lock_guard<std::mutex> lock(m);
doSomething();
```

RAII 保证离开作用域自动解锁。

---

## 22.3 lock_guard、unique_lock、scoped_lock

| 类型        | 特点                                                             |
| ----------- | ---------------------------------------------------------------- |
| lock_guard  | 最简单，构造加锁，析构解锁，不能手动 unlock                      |
| unique_lock | 更灵活，可延迟加锁、手动 unlock、移动，condition_variable 需要它 |
| scoped_lock | C++17，可一次锁多个 mutex，避免死锁                              |

例子：

```cpp
std::lock_guard<std::mutex> lock(m);
```

```cpp
std::unique_lock<std::mutex> lock(m);
lock.unlock();
lock.lock();
```

```cpp
std::scoped_lock lock(m1, m2);
```

---

## 22.4 死锁

典型死锁：

```cpp
// thread 1
lock(m1);
lock(m2);

// thread 2
lock(m2);
lock(m1);
```

避免方式：

1. 固定加锁顺序。
2. 使用 `std::scoped_lock(m1, m2)`。
3. 减少锁粒度。
4. 不在持锁时调用未知外部代码。
5. 使用 try_lock 超时退避。
6. 用 RAII 管理锁。

---

# 23. condition_variable

## 23.1 wait 为什么要配合谓词

条件变量可能出现：

1. 虚假唤醒。
2. 先 notify 后 wait 导致错过通知。
3. 多消费者竞争时，醒来后条件已经不成立。

错误：

```cpp
cv.wait(lock);
if (ready) {
    consume();
}
```

正确：

```cpp
cv.wait(lock, [] {
    return ready;
});
consume();
```

等价于：

```cpp
while (!ready) {
    cv.wait(lock);
}
```

---

## 23.2 producer/consumer 正确写法

```cpp
std::mutex m;
std::condition_variable cv;
bool ready = false;

void consumer() {
    std::unique_lock<std::mutex> lock(m);
    cv.wait(lock, [] {
        return ready;
    });
    consume();
}

void producer() {
    {
        std::lock_guard<std::mutex> lock(m);
        ready = true;
    }
    cv.notify_one();
}
```

关键点：

1. 修改共享变量 ready 要加锁。
2. wait 要用谓词。
3. notify 可以在解锁后调用，减少被唤醒线程再次阻塞的概率。

---

# 24. atomic 与内存模型

## 24.1 atomic 和 mutex 的区别

`std::atomic<T>`：

1. 保证单个对象操作原子性。
2. 不需要显式加锁。
3. 适合简单计数器、状态标志、无锁结构。
4. 不能轻松保护多个变量的不变量。

`mutex`：

1. 保护临界区。
2. 可以保护多个变量之间的不变量。
3. 可能阻塞。
4. 使用更直观。

---

## 24.2 memory_order_relaxed

只保证原子性，不保证同步顺序。

```cpp
counter.fetch_add(1, std::memory_order_relaxed);
```

适合统计计数，不用于发布数据。

---

## 24.3 release/acquire

release 用于发布数据：

```cpp
data = 42;
ready.store(true, std::memory_order_release);
```

acquire 用于获取数据：

```cpp
while (!ready.load(std::memory_order_acquire)) {}
std::cout << data;
```

如果 acquire 读到了 release 写入的值，则 release 之前的写入对 acquire 之后可见。

所以下面代码一定输出 42：

```cpp
std::atomic<bool> ready{false};
int data = 0;

void producer() {
    data = 42;
    ready.store(true, std::memory_order_release);
}

void consumer() {
    while (!ready.load(std::memory_order_acquire)) {}
    std::cout << data << std::endl;
}
```

前提是没有其他数据竞争修改 data。

---

## 24.4 acq_rel

用于读改写操作，例如：

```cpp
flag.exchange(true, std::memory_order_acq_rel);
```

同时具有 acquire 和 release 语义。

---

## 24.5 seq_cst

最强内存序。

```cpp
x.store(1, std::memory_order_seq_cst);
```

默认 atomic 操作就是 seq_cst。

优点：

1. 最容易理解。
2. 全局顺序一致。

缺点：

1. 可能性能成本更高。



> 除非非常理解内存模型，否则业务代码优先使用 mutex 或默认 seq_cst。relaxed/acquire/release 要有明确理由。

---

# 25. C++17/20 常见特性

## 25.1 auto 类型推导

`auto` 会丢掉顶层 const 和引用。

```cpp
const int x = 10;
auto a = x; // int，不是 const int

int& r = a;
auto b = r; // int，不是 int&
```

想保留引用：

```cpp
auto& c = r;
```

万能引用：

```cpp
auto&& d = expr;
```

---

## 25.2 decltype

```cpp
int x = 10;

decltype(x) a = 1;   // int
decltype((x)) b = x; // int&
```

规则：

1. `decltype(x)` 如果 x 是未加括号的变量名，得到声明类型。
2. `decltype((x))` 中 `(x)` 是左值表达式，得到 `T&`。

---

## 25.3 move-only 类型

只能移动，不能拷贝的类型。

例子：

```cpp
std::unique_ptr<int>
std::thread
std::mutex
std::fstream
```

原因：

它们表示独占资源，拷贝会导致所有权不清。

---

## 25.4 structured binding

```cpp
std::pair<int, std::string> p{1, "hello"};

auto [id, name] = p;
```

注意拷贝：

```cpp
auto [id, name] = p;   // 拷贝
auto& [rid, rname] = p; // 引用
```

---

## 25.5 if initializer

```cpp
if (auto it = mp.find(key); it != mp.end()) {
    use(it->second);
}
```

---

# 26. optional、variant、any、string_view、span

## 26.1 optional

表示“可能有值，也可能没有值”。

```cpp
std::optional<int> find_id(const std::string& name);
```

使用：

```cpp
auto id = find_id("Tom");
if (id) {
    std::cout << *id;
}
```

适合替代：

1. 特殊值，例如 -1。
2. 输出参数。
3. 指针表示可选值。

---

## 26.2 variant

类型安全的 union。

```cpp
std::variant<int, std::string> v;

v = 10;
v = "hello";
```

访问：

```cpp
std::visit([](auto&& value) {
    std::cout << value;
}, v);
```

适合：

1. 一个值可能是有限几种类型之一。
2. 替代继承层级。
3. 表达状态机。

---

## 26.3 any

可以存任意类型。

```cpp
std::any a = 10;
a = std::string("hello");
```

访问：

```cpp
auto s = std::any_cast<std::string>(a);
```

适合：

1. 插件系统。
2. 异构属性表。
3. 类型不固定但运行期能处理。

缺点：

1. 类型安全较弱。
2. 运行时检查。
3. 滥用会降低可维护性。

---

## 26.4 string_view

非拥有字符串视图。

优点：

1. 不拷贝字符串。
2. 可表示字符串子串。
3. 函数参数更灵活。

```cpp
void print(std::string_view sv);
```

风险：

```cpp
std::string_view getName() {
    std::string s = "hello";
    return s; // dangling
}
```

正确：

```cpp
std::string getName() {
    return "hello";
}
```

或者确保底层字符串生命周期更长。

---

## 26.5 span

`std::span<T>` 是连续内存的非拥有视图。

```cpp
void process(std::span<int> data) {
    for (int& x : data) {
        ++x;
    }
}
```

可以接受：

```cpp
int arr[3]{1, 2, 3};
std::vector<int> v{1, 2, 3};

process(arr);
process(v);
```

特点：

1. 不拥有数据。
2. 保存指针和长度。
3. 比裸指针 + size 更安全。
4. 生命周期仍然要靠调用者保证。

---

# 27. 编译、链接、ODR、inline

## 27.1 编译流程

大致流程：

1. 预处理：展开 include、宏。
2. 编译：词法、语法、语义分析，生成汇编或 IR。
3. 汇编：生成目标文件 `.o`。
4. 链接：解析符号，合并目标文件和库，生成可执行文件。

```text
.cpp -> .i -> .s -> .o -> executable
```

---

## 27.2 声明与定义

声明告诉编译器“有这个东西”。

定义真正分配实体或提供实现。

```cpp
extern int x; // 声明
int y;        // 定义

void f();     // 声明
void g() {}   // 定义

class A;      // 声明
class B {};   // 定义
```

---

## 27.3 ODR

ODR：One Definition Rule，单一定义规则。

核心：

1. 一个变量或函数在整个程序中只能有一个定义。
2. 类型定义在多个翻译单元中可以重复出现，但必须完全一致。
3. inline 函数和模板可以在多个翻译单元中定义，但定义必须一致。

违反 ODR 可能导致：

1. 链接错误。
2. 未定义行为。
3. 不同翻译单元看到不同类布局。
4. 奇怪的运行期错误。

---

## 27.4 头文件定义全局变量的问题

错误：

```cpp
// config.h
int g_value = 10;
```

多个 cpp include 后，每个翻译单元都有一个定义，链接时重复定义。

解决：

方式一：头文件声明，cpp 定义。

```cpp
// config.h
extern int g_value;

// config.cpp
int g_value = 10;
```

方式二：C++17 inline variable。

```cpp
// config.h
inline int g_value = 10;
```

---

## 27.5 inline 的现代意义

`inline` 不只是建议编译器内联。

更重要的是：

> 允许函数或变量在多个翻译单元中有定义，只要定义完全一致。

头文件中定义函数：

```cpp
inline int add(int a, int b) {
    return a + b;
}
```

C++17 inline variable：

```cpp
inline constexpr int max_size = 1024;
```

---

# 28. static、extern、头文件设计

## 28.1 函数内 static 局部变量

```cpp
int next_id() {
    static int id = 0;
    return ++id;
}
```

特点：

1. 生命周期贯穿程序。
2. 作用域在函数内。
3. 初始化一次。
4. C++11 起局部静态变量初始化线程安全。

---

## 28.2 全局 static

```cpp
static int g = 10;
```

含义：

> 内部链接，只在当前翻译单元可见。

---

## 28.3 static 函数

```cpp
static void helper() {}
```

同样是内部链接，只在当前 cpp 可见。

现代 C++ 更推荐匿名命名空间：

```cpp
namespace {
void helper() {}
}
```

---

## 28.4 类 static 成员

```cpp
class A {
public:
    static int count;
    static void f();
};
```

特点：

1. 属于类，不属于某个对象。
2. static 成员函数没有 this 指针。
3. static 成员函数不能直接访问非 static 成员。

定义：

```cpp
int A::count = 0;
```

C++17 可用 inline static：

```cpp
class A {
public:
    inline static int count = 0;
};
```

---

# 29. ABI 与动态库二进制兼容

## 29.1 ABI 是什么

ABI：Application Binary Interface。

包括：

1. 函数调用约定。
2. 参数如何传递。
3. 返回值如何传递。
4. 名字修饰 name mangling。
5. 类对象布局。
6. vtable 布局。
7. 异常处理机制。
8. 标准库类型布局。

---

## 29.2 为什么 C++ ABI 更脆弱

C++ 比 C 更容易出 ABI 问题，因为 C++ 有：

1. 函数重载导致 name mangling。
2. 类布局可能变化。
3. 虚函数表顺序可能变化。
4. inline 函数编译进调用方。
5. 模板代码编译进调用方。
6. STL 类型跨库边界可能不兼容。
7. 不同编译器 ABI 不一致。

---

## 29.3 哪些修改会破坏 ABI

可能破坏 ABI 的修改：

1. 给类增加非静态成员。
2. 改变成员顺序。
3. 增加、删除、重排虚函数。
4. 改变基类。
5. 改变函数签名。
6. 改变 inline 函数实现但调用方不重新编译。
7. 改变模板定义但调用方不重新编译。

---

# 30. 性能优化

## 30.1 先测量再优化

不要凭感觉优化。

常见工具：

1. perf
2. gprof
3. Valgrind / callgrind
4. heaptrack
5. Linux perf top
6. VTune
7. Instruments
8. ASan/TSan/UBSan 辅助发现错误



> 性能优化第一步是定位瓶颈，先用 profiler 观察 CPU、内存、锁、I/O，再决定优化方向。

---

## 30.2 vector 为什么通常比 list 遍历快

虽然 list 插入删除 O(1)，但遍历时：

1. 节点分散在堆上。
2. 缓存不友好。
3. 每次访问都可能 cache miss。
4. 指针追踪影响 CPU 预取。

vector 连续存储，CPU cache 友好，遍历通常更快。

---

## 30.3 缓存局部性

CPU 访问内存不是只加载一个字节，而是加载一个 cache line。

连续内存更容易利用缓存。

```cpp
std::vector<int> v;
for (int x : v) {
    sum += x;
}
```

比链表遍历更容易命中缓存。

---

## 30.4 分支预测

CPU 会预测分支方向。

如果分支随机，预测失败会导致流水线清空。

```cpp
if (data[i] > threshold) {
    ++count;
}
```

如果数据分布随机，可能较慢。

---

## 30.5 虚函数性能

虚函数调用成本：

1. 多一次间接访问。
2. 可能阻碍内联。
3. 可能影响分支预测。

但不要过度优化。虚函数成本通常不是主要瓶颈，除非在极热路径、大量小对象上频繁调用。

去虚化：

如果编译器能知道实际类型，就可能优化为普通调用。

```cpp
Derived d;
d.foo(); // 容易去虚化
```

---

## 30.6 内存分配

频繁 new/delete 可能慢：

1. 分配器开销。
2. 锁竞争。
3. 内存碎片。
4. cache miss。

优化方式：

1. reserve。
2. 对象池。
3. arena allocator。
4. pmr。
5. 避免临时对象。
6. 批量分配。

---

## 30.7 常见代码优化

原代码：

```cpp
std::vector<std::string> v;

for (int i = 0; i < n; ++i) {
    std::string s = getString(i);
    v.push_back(s);
}
```

问题：

1. vector 可能多次扩容。
2. push_back(s) 会拷贝字符串。
3. 临时对象可以移动。

优化：

```cpp
std::vector<std::string> v;
v.reserve(n);

for (int i = 0; i < n; ++i) {
    v.push_back(getString(i));
}
```

或者：

```cpp
v.emplace_back(getString(i));
```

如果已经有变量：

```cpp
std::string s = getString(i);
v.push_back(std::move(s));
```

---

# 31. undefined behavior

## 31.1 什么是 UB

Undefined Behavior，未定义行为。

意思是：

> C++ 标准没有规定结果，程序可以表现为任何行为。

可能结果：

1. 看似正常。
2. 崩溃。
3. 输出奇怪值。
4. 被编译器优化成完全意想不到的代码。
5. 安全漏洞。

---

## 31.2 常见 UB

### 空指针解引用

```cpp
int* p = nullptr;
*p = 1; // UB
```

### 数组越界

```cpp
int arr[3]{1, 2, 3};
int x = arr[5]; // UB
```

### signed integer overflow

```cpp
int a = INT_MAX;
a = a + 1; // UB
```

### unsigned overflow

```cpp
unsigned int b = UINT_MAX;
b = b + 1; // OK，按模运算回绕
```

### 返回局部变量引用

```cpp
int& f() {
    int x = 10;
    return x; // UB if used
}
```

---

## 31.3 i = i++ 是不是 UB

在现代 C++ 中，需要具体看标准版本和表达式规则。

> 这类表达式可读性极差，历史上涉及未排序修改问题，容易引发未定义或未指定行为。实际工程中绝对不应该写，应拆成明确的两步。

更好的写法：

```cpp
++i;
// or
int old = i++;
```

---

# 32. 返回局部对象

## 32.1 返回值安全

```cpp
T make1() {
    T t;
    return t;
}
```

安全。

可能触发 NRVO，或者移动。

---

## 32.2 返回临时对象安全

```cpp
T make2() {
    return T{};
}
```

安全。C++17 起通常强制拷贝省略。

---

## 32.3 返回局部对象右值引用危险

```cpp
T&& make3() {
    T t;
    return std::move(t);
}
```

严重错误。

`t` 是局部变量，函数结束后销毁。返回 `T&&` 是悬垂引用。

正确：

```cpp
T make3() {
    T t;
    return t;
}
```

不要返回局部对象的引用或右值引用。

---

# 33. vector<bool>

`std::vector<bool>` 是标准库对 bool 的特殊化。

它通常不是每个 bool 一个字节，而是按 bit 压缩存储。

问题：

1. `operator[]` 返回的不是 `bool&`，而是代理对象。
2. 不能获得真正的 bool 指针。
3. 和普通 vector<T> 行为不完全一致。
4. 多线程按 bit 修改可能影响同一个底层字节。
5. 泛型代码可能踩坑。

替代：

```cpp
std::vector<char>
std::vector<uint8_t>
std::bitset<N>
boost::dynamic_bitset
```

---

# 34. 高频手写：简化 unique_ptr

```cpp
template <typename T>
class UniquePtr {
public:
    explicit UniquePtr(T* ptr = nullptr) noexcept
        : ptr_(ptr) {}

    ~UniquePtr() {
        delete ptr_;
    }

    UniquePtr(const UniquePtr&) = delete;
    UniquePtr& operator=(const UniquePtr&) = delete;

    UniquePtr(UniquePtr&& other) noexcept
        : ptr_(other.ptr_) {
        other.ptr_ = nullptr;
    }

    UniquePtr& operator=(UniquePtr&& other) noexcept {
        if (this == &other) {
            return *this;
        }

        delete ptr_;
        ptr_ = other.ptr_;
        other.ptr_ = nullptr;

        return *this;
    }

    T& operator*() const {
        return *ptr_;
    }

    T* operator->() const noexcept {
        return ptr_;
    }

    T* get() const noexcept {
        return ptr_;
    }

    T* release() noexcept {
        T* old = ptr_;
        ptr_ = nullptr;
        return old;
    }

    void reset(T* ptr = nullptr) noexcept {
        if (ptr_ == ptr) {
            return;
        }

        delete ptr_;
        ptr_ = ptr;
    }

    explicit operator bool() const noexcept {
        return ptr_ != nullptr;
    }

private:
    T* ptr_{nullptr};
};
```

注意：

1. 移动构造后要把源对象置空。
2. 移动赋值前要释放自己的旧资源。
3. release 返回裸指针，并放弃所有权。
4. reset 删除旧对象并接管新对象。
5. operator-> 返回指针。
6. operator* 返回引用。

---

# 35. 高频手写：线程安全队列

```cpp
#include <condition_variable>
#include <mutex>
#include <queue>

template <typename T>
class ThreadSafeQueue {
public:
    ThreadSafeQueue() = default;

    ThreadSafeQueue(const ThreadSafeQueue&) = delete;
    ThreadSafeQueue& operator=(const ThreadSafeQueue&) = delete;

    void push(T value) {
        {
            std::lock_guard<std::mutex> lock(mutex_);
            queue_.push(std::move(value));
        }
        cv_.notify_one();
    }

    bool try_pop(T& value) {
        std::lock_guard<std::mutex> lock(mutex_);

        if (queue_.empty()) {
            return false;
        }

        value = std::move(queue_.front());
        queue_.pop();
        return true;
    }

    T wait_and_pop() {
        std::unique_lock<std::mutex> lock(mutex_);

        cv_.wait(lock, [this] {
            return !queue_.empty();
        });

        T value = std::move(queue_.front());
        queue_.pop();
        return value;
    }

    bool empty() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return queue_.empty();
    }

private:
    mutable std::mutex mutex_;
    std::condition_variable cv_;
    std::queue<T> queue_;
};
```

注意：

1. `empty() const` 里 mutex 要是 mutable。
2. wait 必须用谓词。
3. push 先加锁修改队列，再 notify。
4. 不要返回引用，因为 pop 后元素不存在。
5. 如果要支持关闭，需要增加 closed_ 标志。

---

# 36. 高频手写：有停止机制的生产者消费者队列

```cpp
#include <condition_variable>
#include <mutex>
#include <queue>
#include <optional>

template <typename T>
class BlockingQueue {
public:
    explicit BlockingQueue(size_t capacity)
        : capacity_(capacity) {}

    bool push(T value) {
        std::unique_lock<std::mutex> lock(mutex_);

        not_full_.wait(lock, [this] {
            return closed_ || queue_.size() < capacity_;
        });

        if (closed_) {
            return false;
        }

        queue_.push(std::move(value));
        not_empty_.notify_one();
        return true;
    }

    std::optional<T> pop() {
        std::unique_lock<std::mutex> lock(mutex_);

        not_empty_.wait(lock, [this] {
            return closed_ || !queue_.empty();
        });

        if (queue_.empty()) {
            return std::nullopt;
        }

        T value = std::move(queue_.front());
        queue_.pop();

        not_full_.notify_one();
        return value;
    }

    void close() {
        {
            std::lock_guard<std::mutex> lock(mutex_);
            closed_ = true;
        }

        not_empty_.notify_all();
        not_full_.notify_all();
    }

private:
    size_t capacity_;
    bool closed_{false};

    std::mutex mutex_;
    std::condition_variable not_empty_;
    std::condition_variable not_full_;
    std::queue<T> queue_;
};
```

重点：

1. 队列满时生产者等待。
2. 队列空时消费者等待。
3. wait 要有谓词。
4. close 时要 notify_all。
5. closed_ 要在锁保护下访问。

---

# 37. 高频手写：LRU Cache

## 37.1 思路

要求 get/put 平均 O(1)。

使用：

1. `std::list<std::pair<int, int>>` 保存访问顺序。
2. `std::unordered_map<int, list::iterator>` 保存 key 到链表节点的映射。

链表头表示最近使用，链表尾表示最久未使用。

---

## 37.2 实现

```cpp
#include <list>
#include <unordered_map>

class LRUCache {
public:
    explicit LRUCache(size_t capacity)
        : capacity_(capacity) {}

    int get(int key) {
        auto it = map_.find(key);
        if (it == map_.end()) {
            return -1;
        }

        // 移动到链表头
        items_.splice(items_.begin(), items_, it->second);

        return it->second->second;
    }

    void put(int key, int value) {
        auto it = map_.find(key);

        if (it != map_.end()) {
            it->second->second = value;
            items_.splice(items_.begin(), items_, it->second);
            return;
        }

        if (capacity_ == 0) {
            return;
        }

        if (items_.size() == capacity_) {
            auto last = items_.back();
            map_.erase(last.first);
            items_.pop_back();
        }

        items_.emplace_front(key, value);
        map_[key] = items_.begin();
    }

private:
    size_t capacity_;
    std::list<std::pair<int, int>> items_;
    std::unordered_map<int, std::list<std::pair<int, int>>::iterator> map_;
};
```

关键点：

1. list 节点移动 O(1)。
2. unordered_map 查找 O(1) 平均。
3. splice 不会拷贝元素。
4. map 保存迭代器，方便直接定位节点。

---

# 38. 一段话回答



## 38.1 解释 RAII


> RAII 是 C++ 资源管理的核心思想，全称是 Resource Acquisition Is Initialization。它把资源的获取和对象初始化绑定，把资源释放和对象析构绑定。这样当对象离开作用域时，无论正常返回还是异常退出，析构函数都会自动执行，从而释放资源。比如 unique_ptr 管理堆内存，lock_guard 管理 mutex，fstream 管理文件句柄。现代 C++ 中我们尽量避免裸指针拥有资源，而是使用 RAII 类型和标准库容器，这样能减少内存泄漏、异常路径泄漏和手动释放错误。

---

## 38.2 解释移动语义



> 移动语义的目标是避免不必要的深拷贝。对于拥有资源的对象，比如 string、vector、unique_ptr，如果源对象是右值或者即将不用，可以通过移动构造或移动赋值把内部资源直接转移给目标对象。std::move 本身不移动，它只是把表达式转换成右值，真正的移动发生在类型的移动构造或移动赋值中。移动后源对象仍然有效，但值未指定。对于资源管理类，移动操作一般只是交换指针或接管句柄，所以应尽量标记 noexcept，以便 STL 容器扩容时优先使用移动。

---

## 38.3 解释 shared_ptr 控制块



> shared_ptr 不只是保存一个裸指针，它还关联一个控制块。控制块里通常有强引用计数、弱引用计数、删除器、分配器等信息。多个 shared_ptr 共享同一个控制块，强引用计数为 0 时对象被销毁，弱引用计数为 0 时控制块释放。不能用同一个裸指针构造多个 shared_ptr，因为那会产生多个控制块，最终 double delete。正确做法是用 make_shared 或从已有 shared_ptr 拷贝。

---

## 38.4 解释 condition_variable



> condition_variable 用于线程间等待某个条件成立。它必须配合 mutex 使用，因为条件本身通常是共享状态。wait 时要使用 while 或谓词，因为可能发生虚假唤醒，也可能多个消费者被唤醒后条件又不成立。典型写法是 unique_lock 加锁，然后 cv.wait(lock, predicate)。生产者修改共享状态时也要加锁，修改后 notify_one 或 notify_all。

---

## 38.5 解释 unordered_map 最坏复杂度


> unordered_map 平均查找是 O(1)，但最坏是 O(n)。因为它基于哈希表，如果大量 key 发生哈希冲突，元素落入同一个桶中，查找就退化为遍历桶内元素。实际性能依赖 hash 函数质量、负载因子和 rehash 策略。如果需要有序遍历或稳定的最坏复杂度，可以选择 map。

## 38.6 怎么理解现代 C++？

> 我理解现代 C++ 的核心是用类型系统和对象生命周期来管理复杂性。资源管理上尽量使用 RAII，把资源释放放到析构函数中，避免手动 new/delete。所有权表达上，独占资源用 unique_ptr，共享资源用 shared_ptr，非拥有观察用 weak_ptr 或裸指针/引用。对象设计上尽量遵守 Rule of Zero，让标准库容器和智能指针处理拷贝移动和析构。性能上理解值语义和移动语义，避免不必要拷贝，使用 reserve、emplace、string_view/span 等减少分配。并发上避免数据竞争，用 mutex、condition_variable、atomic 等工具表达同步关系。泛型编程上使用模板、type traits 和 concepts 写出类型安全、可复用的代码。整体目标是写出资源安全、异常安全、并发安全、性能可控的代码。

## 38.7 C++ 如何避免资源泄漏？

> C++ 主要通过 RAII 管理资源。RAII 的思想是把资源的生命周期绑定到对象生命周期上，在构造函数中获取资源，在析构函数中释放资源。这样对象离开作用域时，无论是正常返回还是异常退出，析构函数都会执行，从而保证资源被释放。比如内存用 unique_ptr/shared_ptr，锁用 lock_guard/unique_lock，文件句柄可以封装成类。现代 C++ 推荐避免裸指针拥有资源，优先使用标准库容器和智能指针，尽量遵守 Rule of Zero。