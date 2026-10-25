void legacy_log(int);
void modern_log(int); // The exercise defines this as a compatible replacement.

#define LOG(value) legacy_log(value)

void direct() { legacy_log(1); } // Diagnostic and fix-it.
void macro() { LOG(2); }        // Diagnostic, no automatic fix inside a macro.

template <class T> void example(T) { legacy_log(3); }
void instantiate() {
  example(1);
  example(1.0); // The same spelled call should not be reported once per instantiation.
}
