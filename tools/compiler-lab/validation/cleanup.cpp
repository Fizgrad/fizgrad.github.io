#include <cstdio>

int cleaned = 0;
struct Guard {
    ~Guard() noexcept { ++cleaned; }
};

void maybe_throw(bool fail) {
    if (fail) throw 7;
}

void work(bool fail) {
    Guard guard;
    maybe_throw(fail);
}

int main() {
    work(false);
    try { work(true); } catch (int) {}
    std::printf("%d\n", cleaned);
    return cleaned == 2 ? 0 : 1;
}
