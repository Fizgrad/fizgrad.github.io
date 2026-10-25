#include "clang/AST/Expr.h"
#include "clang/ASTMatchers/ASTMatchFinder.h"
#include "clang/Basic/Diagnostic.h"
#include "clang/Basic/SourceManager.h"
#include "clang/Tooling/CommonOptionsParser.h"
#include "clang/Tooling/Tooling.h"
#include "llvm/Support/CommandLine.h"
#include "llvm/Support/raw_ostream.h"

using namespace clang;
using namespace clang::ast_matchers;
using namespace clang::tooling;

namespace {
llvm::cl::OptionCategory Category("find-legacy-call options");

class ReportCall : public MatchFinder::MatchCallback {
public:
  void run(const MatchFinder::MatchResult &Result) override {
    const auto *Call = Result.Nodes.getNodeAs<CallExpr>("call");
    if (!Call)
      return;
    const auto *Ref = dyn_cast<DeclRefExpr>(Call->getCallee()->IgnoreParenImpCasts());
    SourceLocation Loc = Ref ? Ref->getLocation() : Call->getExprLoc();
    DiagnosticsEngine &Diags = Result.Context->getDiagnostics();
    unsigned ID = Diags.getCustomDiagID(DiagnosticsEngine::Warning,
                                       "call to legacy_log; use modern_log");
    auto Report = Diags.Report(Loc, ID);
    // Only suggest replacing a literal identifier in this source file.
    if (Ref && !Loc.isMacroID() && Result.SourceManager->isWrittenInMainFile(Loc))
      Report << FixItHint::CreateReplacement(SourceRange(Loc, Loc), "modern_log");
  }
};
} // namespace

int main(int argc, const char **argv) {
  auto Options = CommonOptionsParser::create(argc, argv, Category);
  if (!Options) {
    llvm::errs() << Options.takeError();
    return 1;
  }
  ClangTool Tool(Options->getCompilations(), Options->getSourcePathList());
  ReportCall Callback;
  MatchFinder Finder;
  Finder.addMatcher(
      traverse(TK_IgnoreUnlessSpelledInSource,
               callExpr(callee(functionDecl(hasName("::legacy_log"))),
                        isExpansionInMainFile()).bind("call")),
      &Callback);
  return Tool.run(newFrontendActionFactory(&Finder).get());
}
