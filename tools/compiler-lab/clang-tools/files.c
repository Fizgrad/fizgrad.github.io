typedef struct TutorialFile TutorialFile;
TutorialFile *tutorial_open(void); // Non-null on success, null on failure.
void tutorial_close(TutorialFile *); // Consumes one open resource.
void tutorial_take(TutorialFile *); // Transfers ownership to the callee.
void unknown(TutorialFile *);

void balanced(void) {
    TutorialFile *p = tutorial_open();
    if (!p) return;
    tutorial_close(p);
}

void twice(void) {
    TutorialFile *p = tutorial_open();
    if (!p) return;
    TutorialFile *alias = p;
    tutorial_close(alias);
    tutorial_close(p); // expected-warning{{File is closed more than once}}
}

void leak(void) {
    TutorialFile *p = tutorial_open();
    if (!p) return;
} // expected-warning{{Opened file is not closed}}

void conditional(int close_it) {
    TutorialFile *p = tutorial_open();
    if (!p) return;
    if (close_it) tutorial_close(p);
} // expected-warning{{Opened file is not closed}}

void transferred(void) {
    TutorialFile *p = tutorial_open();
    if (!p) return;
    tutorial_take(p);
}

void escaped(void) {
    TutorialFile *p = tutorial_open();
    if (!p) return;
    unknown(p); // Model boundary: no leak claim after unknown ownership effects.
}
