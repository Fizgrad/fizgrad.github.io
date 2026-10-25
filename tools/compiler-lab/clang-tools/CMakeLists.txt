cmake_minimum_required(VERSION 3.20)
project(ClangLab LANGUAGES C CXX)
find_package(LLVM REQUIRED CONFIG)
find_package(Clang REQUIRED CONFIG)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
include_directories(SYSTEM ${LLVM_INCLUDE_DIRS} ${CLANG_INCLUDE_DIRS})
add_definitions(${LLVM_DEFINITIONS})
if(NOT LLVM_ENABLE_RTTI)
  add_compile_options(-fno-rtti)
endif()

add_executable(find-legacy-call FindLegacyCall.cpp)
target_link_libraries(find-legacy-call PRIVATE clangTooling clangASTMatchers clangFrontend)

# Linux/ELF module: Clang supplies the unresolved analyzer symbols when loading it.
# Do not embed a second copy of Clang/LLVM static libraries in this plugin.
add_library(FileState MODULE FileStateChecker.cpp)
set_target_properties(FileState PROPERTIES PREFIX "")
if(APPLE)
  target_link_options(FileState PRIVATE "-undefined" "dynamic_lookup")
endif()
