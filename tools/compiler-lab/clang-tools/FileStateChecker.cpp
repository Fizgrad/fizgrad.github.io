#include "clang/AST/Decl.h"
#include "clang/StaticAnalyzer/Core/BugReporter/BugType.h"
#include "clang/StaticAnalyzer/Core/Checker.h"
#include "clang/StaticAnalyzer/Core/PathSensitive/CallEvent.h"
#include "clang/StaticAnalyzer/Core/PathSensitive/CheckerContext.h"
#include "clang/StaticAnalyzer/Core/PathSensitive/ProgramStateTrait.h"
#include "clang/StaticAnalyzer/Frontend/CheckerRegistry.h"
#include "llvm/ADT/SmallVector.h"

using namespace clang;
using namespace ento;

enum class FileState { Open, Closed };
REGISTER_MAP_WITH_PROGRAMSTATE(Files, SymbolRef, FileState)

namespace {
bool isAPI(const CallEvent &Call, llvm::StringRef Name, unsigned Arity) {
  const auto *FD = dyn_cast_or_null<FunctionDecl>(Call.getDecl());
  return FD && FD->getIdentifier() && FD->getDeclContext()->isTranslationUnit() &&
         FD->getName() == Name && Call.getNumArgs() == Arity;
}

class FileStateChecker final
    : public Checker<check::PostCall, check::PreCall, check::DeadSymbols,
                     check::PointerEscape> {
  const BugType DoubleClose{this, "Double close", "Resource lifetime"};
  const BugType Leak{this, "File leak", "Resource lifetime"};

public:
  void checkPostCall(const CallEvent &Call, CheckerContext &C) const {
    if (!isAPI(Call, "tutorial_open", 0))
      return;
    SVal Result = Call.getReturnValue();
    SymbolRef Sym = Result.getAsSymbol();
    auto Defined = Result.getAs<DefinedOrUnknownSVal>();
    if (!Sym || !Defined)
      return;
    // An allocation failure must not acquire a resource obligation.
    if (ProgramStateRef Good = C.getState()->assume(*Defined, true))
      C.addTransition(Good->set<Files>(Sym, FileState::Open));
    if (ProgramStateRef Failed = C.getState()->assume(*Defined, false))
      C.addTransition(Failed);
  }

  void checkPreCall(const CallEvent &Call, CheckerContext &C) const {
    bool Close = isAPI(Call, "tutorial_close", 1);
    bool Take = isAPI(Call, "tutorial_take", 1);
    if (!Close && !Take)
      return;
    SymbolRef Sym = Call.getArgSVal(0).getAsSymbol();
    if (!Sym)
      return;
    ProgramStateRef State = C.getState();
    if (Take) {
      C.addTransition(State->remove<Files>(Sym));
      return;
    }
    const FileState *Tracked = State->get<Files>(Sym);
    if (!Tracked)
      return;
    if (*Tracked == FileState::Closed) {
      if (ExplodedNode *N = C.generateErrorNode()) {
        auto Report = std::make_unique<PathSensitiveBugReport>(
            DoubleClose, "File is closed more than once", N);
        Report->markInteresting(Sym);
        C.emitReport(std::move(Report));
      }
      return;
    }
    C.addTransition(State->set<Files>(Sym, FileState::Closed));
  }

  void checkDeadSymbols(SymbolReaper &Reaper, CheckerContext &C) const {
    ProgramStateRef State = C.getState();
    llvm::SmallVector<SymbolRef, 2> Leaks;
    for (const auto &Entry : State->get<Files>()) {
      if (!Reaper.isDead(Entry.first))
        continue;
      if (Entry.second == FileState::Open)
        Leaks.push_back(Entry.first);
      State = State->remove<Files>(Entry.first);
    }
    if (Leaks.empty()) {
      C.addTransition(State);
      return;
    }
    if (ExplodedNode *N = C.generateNonFatalErrorNode(State)) {
      for (SymbolRef Sym : Leaks) {
        auto Report = std::make_unique<PathSensitiveBugReport>(
            Leak, "Opened file is not closed", N);
        Report->markInteresting(Sym);
        C.emitReport(std::move(Report));
      }
    }
  }

  ProgramStateRef checkPointerEscape(ProgramStateRef State,
                                    const InvalidatedSymbols &Escaped,
                                    const CallEvent *Call,
                                    PointerEscapeKind) const {
    if (Call && (isAPI(*Call, "tutorial_open", 0) ||
                 isAPI(*Call, "tutorial_close", 1) ||
                 isAPI(*Call, "tutorial_take", 1)))
      return State;
    // Unknown code may retain/close the resource: stop making ownership claims.
    for (SymbolRef Sym : Escaped)
      State = State->remove<Files>(Sym);
    return State;
  }
};
} // namespace

extern "C" const char clang_analyzerAPIVersionString[] =
    CLANG_ANALYZER_API_VERSION_STRING;

extern "C" void clang_registerCheckers(CheckerRegistry &Registry) {
  Registry.addChecker<FileStateChecker>("lab.FileState",
                                       "Track tutorial file ownership", "");
}
