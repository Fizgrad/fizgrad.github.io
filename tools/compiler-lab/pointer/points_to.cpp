#include <cassert>
#include <iostream>
#include <set>
#include <string>
#include <vector>

enum class Kind { Address, Copy, Load, Store };
struct Constraint { Kind kind; unsigned dst, src; };

int main() {
    // p/q/r/s are pointer values; slot/x/y are distinct abstract objects.
    enum { p, q, r, s, slot, x, y, count };
    const std::vector<std::string> names{"p", "q", "r", "s", "slot", "x", "y"};
    const std::vector<Constraint> code{
        {Kind::Address, p, x},     // p = &x
        {Kind::Address, q, slot},  // q = &slot
        {Kind::Store, q, p},       // *q = p
        {Kind::Load, r, q},        // r = *q
        {Kind::Copy, s, r},        // s = r
        {Kind::Address, p, y},     // p = &y; flow-insensitive analysis keeps both.
    };
    std::vector<std::set<unsigned>> pt(count);
    auto merge = [](auto &dst, const auto &src) {
        auto before = dst.size();
        dst.insert(src.begin(), src.end());
        return dst.size() != before;
    };
    bool changed;
    do {
        changed = false;
        for (auto c : code) {
            switch (c.kind) {
            case Kind::Address: changed |= pt[c.dst].insert(c.src).second; break;
            case Kind::Copy: changed |= merge(pt[c.dst], pt[c.src]); break;
            case Kind::Load:
                for (auto object : pt[c.src]) changed |= merge(pt[c.dst], pt[object]);
                break;
            case Kind::Store:
                for (auto object : pt[c.dst]) changed |= merge(pt[object], pt[c.src]);
                break;
            }
        }
    } while (changed);
    assert((pt[s] == std::set<unsigned>{x, y}));
    for (unsigned id : {p, q, r, s, slot}) {
        std::cout << names[id] << " ->";
        for (auto object : pt[id]) std::cout << ' ' << names[object];
        std::cout << '\n';
    }
}
