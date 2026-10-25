using Function = int (*)(int);
Function left_address();
Function right_address();
int main() { return left_address() == right_address() ? 0 : 1; }
