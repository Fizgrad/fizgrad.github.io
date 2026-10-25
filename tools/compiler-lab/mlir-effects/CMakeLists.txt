cmake_minimum_required(VERSION 3.20)
project(MiniEffects LANGUAGES C CXX)
find_package(MLIR REQUIRED CONFIG)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(LLVM_RUNTIME_OUTPUT_INTDIR ${CMAKE_BINARY_DIR}/bin)
set(LLVM_LIBRARY_OUTPUT_INTDIR ${CMAKE_BINARY_DIR}/lib)
set(MLIR_BINARY_DIR ${CMAKE_BINARY_DIR})
list(APPEND CMAKE_MODULE_PATH "${MLIR_CMAKE_DIR}" "${LLVM_CMAKE_DIR}")
include(TableGen)
include(AddLLVM)
include(AddMLIR)
include(HandleLLVMOptions)
# The example uses MLIR TypeID, not C++ dynamic_cast/typeid.
if(CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
  add_compile_options(-fno-rtti)
endif()
include_directories(${LLVM_INCLUDE_DIRS} ${MLIR_INCLUDE_DIRS})
include_directories(${PROJECT_SOURCE_DIR} ${PROJECT_BINARY_DIR})
link_directories(${LLVM_BUILD_LIBRARY_DIR})
add_definitions(${LLVM_DEFINITIONS})
add_mlir_dialect(MiniOps mini)
add_mlir_dialect_library(MiniEffects
  PARTIAL_SOURCES_INTENDED MiniDialect.cpp
  DEPENDS MLIRMiniOpsIncGen
  LINK_LIBS PUBLIC MLIRIR MLIRSideEffectInterfaces
)
add_llvm_executable(mini-effects-opt PARTIAL_SOURCES_INTENDED mini-effects-opt.cpp)
llvm_update_compile_flags(mini-effects-opt)
target_link_libraries(mini-effects-opt PRIVATE
  MiniEffects MLIRArithDialect MLIRFuncDialect MLIROptLib MLIRTransforms)
mlir_check_all_link_libraries(mini-effects-opt)
