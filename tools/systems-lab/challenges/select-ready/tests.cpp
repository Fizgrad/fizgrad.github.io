#include "linux_test.hpp"
#include "solution.cpp"

#include <algorithm>
#include <chrono>
#include <system_error>
#include <unistd.h>
#include <vector>

using namespace std::chrono_literals;
using systems_lab::make_pipe;

namespace {

void single_ready_pipe() {
    auto [reader, writer] = make_pipe();
    systems_lab::write_all_fd(writer.get(), "x");

    const auto ready = wait_readable_select({reader.get()}, 200ms);
    LAB_CHECK(ready == std::vector<int>{reader.get()});

    char value = 0;
    LAB_CHECK_EQ(::read(reader.get(), &value, 1), 1);
    LAB_CHECK_EQ(value, 'x');
}

void multiple_ready_and_duplicate_descriptors() {
    auto [reader_one, writer_one] = make_pipe();
    auto [reader_two, writer_two] = make_pipe();
    systems_lab::write_all_fd(writer_one.get(), "a");
    systems_lab::write_all_fd(writer_two.get(), "b");

    const auto ready = wait_readable_select(
        {reader_two.get(), reader_one.get(), reader_two.get()}, 200ms);
    std::vector<int> expected{reader_one.get(), reader_two.get()};
    std::sort(expected.begin(), expected.end());
    LAB_CHECK(ready == expected);
}

void timeout_returns_empty() {
    auto [reader, writer] = make_pipe();
    (void)writer;
    const auto started = std::chrono::steady_clock::now();
    const auto ready = wait_readable_select({reader.get()}, 30ms);
    const auto elapsed = std::chrono::steady_clock::now() - started;

    LAB_CHECK(ready.empty());
    LAB_CHECK(elapsed >= 10ms);
    LAB_CHECK(elapsed < 1s);
}

void validates_arguments_and_system_errors() {
    LAB_CHECK_THROWS_AS(wait_readable_select({}, -1ms), std::invalid_argument);
    LAB_CHECK_THROWS_AS(wait_readable_select({-1}, 0ms), std::invalid_argument);
    LAB_CHECK_THROWS_AS(wait_readable_select({FD_SETSIZE}, 0ms), std::invalid_argument);

    auto [reader, writer] = make_pipe();
    (void)writer;
    const int closed = reader.release();
    LAB_CHECK_EQ(::close(closed), 0);
    LAB_CHECK_THROWS_AS(wait_readable_select({closed}, 0ms), std::system_error);
}

} // namespace

int main() {
    return systems_lab::run({
        {"single ready pipe", single_ready_pipe},
        {"multiple ready and duplicate descriptors", multiple_ready_and_duplicate_descriptors},
        {"timeout returns empty", timeout_returns_empty},
        {"argument and error handling", validates_arguments_and_system_errors},
    });
}
