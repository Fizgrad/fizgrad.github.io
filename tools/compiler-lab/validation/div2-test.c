#include <limits.h>
#include <stdio.h>
int divide2(int);

static int check(int x) {
    int actual = divide2(x), expected = x / 2;
    if (actual == expected) return 0;
    printf("%d: actual=%d expected=%d\n", x, actual, expected);
    return 1;
}

int main(void) {
    if (check(-3) || check(INT_MIN) || check(INT_MAX)) return 1;
    for (int x = -32768; x <= 32767; ++x)
        if (check(x)) return 1;
    return 0;
}
