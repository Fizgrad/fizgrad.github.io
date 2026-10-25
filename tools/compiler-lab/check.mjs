import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const option = name => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
function run(command, args, { expected = 0, input, env } = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, input, env });
  if (result.error) throw result.error;
  assert.equal(result.status, expected, `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result;
}
const prefix = option('--prefix') || run('llvm-config', ['--prefix']).stdout.trim();
const work = resolve(option('--build-dir') || mkdtempSync(join(tmpdir(), 'compiler-lab-')));
mkdirSync(work, { recursive: true });
const tool = name => join(prefix, 'bin', name);
const sample = (group, name) => join(root, group, name);
const artifact = (name, text) => {
  const path = join(work, name);
  writeFileSync(path, text);
  return path;
};
for (const [group, extra] of [
  ['llvm-pass', []],
  ['clang-tools', [`-DClang_DIR=${join(prefix, 'lib/cmake/clang')}`]],
  ['mlir-effects', [`-DMLIR_DIR=${join(prefix, 'lib/cmake/mlir')}`]]
]) {
  const build = join(work, group);
  run('cmake', ['-S', join(root, group), '-B', build, '-G', 'Ninja',
    `-DLLVM_DIR=${join(prefix, 'lib/cmake/llvm')}`, `-DCMAKE_CXX_COMPILER=${tool('clang++')}`,
    '-DCMAKE_BUILD_TYPE=Release', ...extra]);
  run('cmake', ['--build', build, '-j', '2']);
  console.log(`PASS build ${group}`);
}

const pass = join(work, 'llvm-pass/MulToShift.so');
const ir = run(tool('opt'), ['-load-pass-plugin', pass, '-passes=function(mul-to-shift),verify',
  '-S', sample('llvm-pass', 'cases.ll')]).stdout;
assert.match(ir, /shl nuw nsw i32 %x, 1/);
assert.match(ir, /mul i32 %x, 3/);
assert.match(ir, /mul <2 x i32>/);
assert.match(ir, /fmul float/);
assert.match(ir, /mul nsw i2 %x, -2/);
const filecheck = option('--filecheck') || join(prefix, 'bin/FileCheck');
if (existsSync(filecheck)) run(filecheck, [sample('llvm-pass', 'cases.ll')], { input: ir });
else console.log('SKIP FileCheck binary; IR assertions and verifier still ran');
console.log('PASS pass transformation, flags and negative cases');

const clangBuild = join(work, 'clang-tools');
const matcher = run(join(clangBuild, 'find-legacy-call'), [sample('clang-tools', 'calls.cpp'), '--',
  '-std=c++17', '-fdiagnostics-parseable-fixits']);
assert.equal((matcher.stderr.match(/warning: call to legacy_log/g) || []).length, 3);
assert.equal((matcher.stderr.match(/fix-it:/g) || []).length, 2);
run(tool('clang'), ['-cc1', '-load', join(clangBuild, 'FileState.so'), '-analyze',
  '-analyzer-checker=core,lab.FileState', '-verify', sample('clang-tools', 'files.c')]);
console.log('PASS AST diagnostics/fix-its, macros/templates and checker expected diagnostics');

const effects = run(join(work, 'mlir-effects/bin/mini-effects-opt'),
  [sample('mlir-effects', 'effects.mlir'), '--canonicalize', '--cse']).stdout;
assert.equal((effects.match(/mini.add/g) || []).length, 1);
assert.equal((effects.match(/mini.touch/g) || []).length, 2);
assert.equal((effects.match(/mini.unknown/g) || []).length, 1);
console.log('PASS MLIR Pure, modeled writes and unknown effects');

run(tool('clang++'), ['-std=c++17', sample('pointer', 'points_to.cpp'), '-o', join(work, 'points-to')]);
assert.match(run(join(work, 'points-to'), []).stdout, /s -> x y/);
run(tool('clang'), ['-S', '-emit-llvm', sample('validation', 'base.c'), '-o', join(work, 'base.ll')]);
const globals = run(join(work, 'llvm-pass/make-global'), [join(work, 'base.ll')]).stdout;
assert.match(globals, /@llvm.global_ctors/);
const created = artifact('created.ll', globals);
run(tool('opt'), ['-passes=verify', '-disable-output', created]);
run(tool('clang'), [created, sample('validation', 'runtime.c'), '-o', join(work, 'globals')]);
run(join(work, 'globals'), []);
const attrs = run(tool('opt'), ['-passes=function(gvn),verify', '-S', sample('validation', 'attributes.ll')]).stdout;
assert.equal((attrs.match(/load i32/g) || []).length, 1);
console.log('PASS points-to fixed point, GlobalVariable/ctor execution and memory attributes');

const loop = run(tool('opt'), ['-passes=function(loop-simplify,lcssa),verify', '-S', sample('validation', 'loop.ll')]).stdout;
assert.match(loop, /header.preheader:/);
assert.match(loop, /%acc.lcssa = phi/);
const vector = join(work, 'vector.ll');
run(tool('clang'), ['-O3', '-march=x86-64-v3', '-fno-discard-value-names', '-S', '-emit-llvm',
  sample('validation', 'vector.c'), '-o', vector]);
assert.match(readFileSync(vector, 'utf8'), /vector.memcheck/);
assert.match(readFileSync(vector, 'utf8'), /load <8 x float>/);
console.log('PASS LoopSimplify, LCSSA and runtime alias checks on the x86-64 vector target');

for (const name of ['src', 'bad', 'good']) {
  const executable = join(work, 'div2-' + name);
  run(tool('clang'), [sample('validation', `div2-${name}.ll`), sample('validation', 'div2-test.c'), '-o', executable]);
  const result = run(executable, [], { expected: name === 'bad' ? 1 : 0 });
  if (name === 'bad') assert.match(result.stdout, /-3: actual=-2 expected=-1/);
}
const alive = option('--alive-tv');
if (alive) {
  const good = run(alive, [sample('validation', 'div2-src.ll'), sample('validation', 'div2-good.ll')]);
  assert.match(good.stdout + good.stderr, /Transformation seems to be correct/);
  // Alive2 exit status for a rejected transform is not used as a portable API.
  const bad = spawnSync(alive, [sample('validation', 'div2-src.ll'), sample('validation', 'div2-bad.ll')], { encoding: 'utf8' });
  assert.match(bad.stdout + bad.stderr, /Transformation doesn't verify/);
} else console.log('SKIP Alive2 executable; signed-division counterexample and runtime tests ran');

run(tool('clang++'), [sample('validation', 'cleanup.cpp'), '-o', join(work, 'cleanup')]);
assert.equal(run(join(work, 'cleanup'), []).stdout.trim(), '2');
const eh = join(work, 'cleanup.ll');
run(tool('clang++'), ['-O0', '-S', '-emit-llvm', sample('validation', 'cleanup.cpp'), '-o', eh]);
assert.match(readFileSync(eh, 'utf8'), /invoke/);
assert.match(readFileSync(eh, 'utf8'), /landingpad/);
const ehObject = join(work, 'cleanup.o');
run(tool('clang++'), ['-O1', '-g', '-c', sample('validation', 'cleanup.cpp'), '-o', ehObject]);
assert.match(run(tool('llvm-dwarfdump'), ['--eh-frame', ehObject]).stdout, /FDE/);
const frame = join(work, 'frame.s');
run(tool('clang++'), ['-target', 'aarch64-linux-gnu', '-O1', '-S', '-fno-omit-frame-pointer',
  '-funwind-tables', sample('validation', 'frame.cpp'), '-o', frame]);
assert.match(readFileSync(frame, 'utf8'), /\.cfi_def_cfa/);
console.log('PASS signed-division boundaries, RAII exception cleanup and AArch64 unwind rules');

const value = join(work, 'value.o');
const main = join(work, 'main.o');
run(tool('clang'), ['-O2', '-c', sample('linking', 'value.c'), '-o', value]);
run(tool('clang'), ['-O2', '-c', sample('linking', 'main.c'), '-o', main]);
run(tool('llvm-ar'), ['rcs', join(work, 'libvalue.a'), value]);
run(tool('clang'), [main, join(work, 'libvalue.a'), '-o', join(work, 'archive-demo')]);
assert.equal(run(join(work, 'archive-demo'), []).stdout.trim(), '42');
run(tool('clang'), ['-O2', '-fPIC', '-shared', sample('linking', 'value.c'), '-Wl,-soname,libvalue.so', '-o', join(work, 'libvalue.so')]);
run(tool('clang'), [main, `-L${work}`, '-lvalue', '-Wl,-rpath,$ORIGIN', '-o', join(work, 'shared-demo')]);
assert.equal(run(join(work, 'shared-demo'), []).stdout.trim(), '42');
run(tool('clang'), ['-O2', '-fPIC', '-shared', sample('linking', 'override.c'), '-o', join(work, 'liboverride.so')]);
assert.equal(run(join(work, 'shared-demo'), [], { env: { ...process.env, LD_PRELOAD: join(work, 'liboverride.so') } }).stdout.trim(), '1002');
const dynamic = run(tool('llvm-readobj'), ['--dynamic-table', join(work, 'shared-demo')]).stdout;
assert.match(dynamic, /libvalue.so/);
assert.match(dynamic, /\$ORIGIN/);
const arm = join(work, 'value-aarch64.o');
run(tool('clang'), ['-target', 'aarch64-linux-gnu', '-fPIC', '-c', sample('linking', 'value.c'), '-o', arm]);
assert.match(run(tool('llvm-readobj'), ['--relocations', arm]).stdout, /R_AARCH64_ADR_GOT_PAGE/);
for (const side of ['left', 'right']) {
  run(tool('clang++'), ['-O2', '-c', sample('linking', `${side}.cpp`), '-o', join(work, side + '.o')]);
}
assert.match(run(tool('llvm-readobj'), ['--section-groups', join(work, 'left.o')]).stdout, /COMDAT/);
run(tool('clang++'), [join(work, 'left.o'), join(work, 'right.o'), sample('linking', 'inline-main.cpp'), '-o', join(work, 'inline-demo')]);
run(join(work, 'inline-demo'), []);
run(tool('clang'), ['-O2', '-flto=thin', '-fuse-ld=lld', sample('linking', 'main.c'),
  sample('linking', 'value.c'), '-o', join(work, 'thinlto-demo')]);
assert.equal(run(join(work, 'thinlto-demo'), []).stdout.trim(), '42');
console.log('PASS ELF archive, shared library, RUNPATH, interposition, COMDAT, ThinLTO and AArch64 GOT relocations');
console.log(`Artifacts: ${work}`);
