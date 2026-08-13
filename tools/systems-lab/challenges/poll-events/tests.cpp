#include "linux_test.hpp"
#include "solution.cpp"

#include <chrono>
#include <poll.h>
#include <unistd.h>
#include <vector>

using namespace std::chrono_literals;
using systems_lab::make_pipe;
using systems_lab::make_socket_pair;

namespace {

void reports_readable_socket() {
    auto [reader, writer] = make_socket_pair();
    systems_lab::write_all_fd(writer.get(), "hello");

    const auto ready = wait_poll_events({{reader.get(), POLLIN}}, 200ms);
    LAB_CHECK_EQ(ready.size(), std::size_t{1});
    LAB_CHECK_EQ(ready[0].fd, reader.get());
    LAB_CHECK((ready[0].revents & POLLIN) != 0);
}

void preserves_input_order_and_ignores_negative_fd() {
    auto [reader_one, writer_one] = make_pipe();
    auto [reader_two, writer_two] = make_pipe();
    systems_lab::write_all_fd(writer_one.get(), "a");
    systems_lab::write_all_fd(writer_two.get(), "b");

    const auto ready = wait_poll_events(
        {{reader_two.get(), POLLIN}, {-1, POLLIN}, {reader_one.get(), POLLIN}}, 200ms);
    LAB_CHECK_EQ(ready.size(), std::size_t{2});
    LAB_CHECK_EQ(ready[0].fd, reader_two.get());
    LAB_CHECK_EQ(ready[1].fd, reader_one.get());
}

void exposes_hangup_and_invalid_descriptor() {
    auto [local, peer] = make_socket_pair();
    peer.reset();
    const auto hangup = wait_poll_events({{local.get(), POLLIN}}, 200ms);
    LAB_CHECK_EQ(hangup.size(), std::size_t{1});
    LAB_CHECK((hangup[0].revents & POLLHUP) != 0);

    auto [reader, writer] = make_pipe();
    (void)writer;
    const int closed = reader.release();
    LAB_CHECK_EQ(::close(closed), 0);
    const auto invalid = wait_poll_events({{closed, POLLIN}}, 0ms);
    LAB_CHECK_EQ(invalid.size(), std::size_t{1});
    LAB_CHECK((invalid[0].revents & POLLNVAL) != 0);
}

void timeout_returns_empty() {
    auto [reader, writer] = make_pipe();
    (void)writer;
    const auto started = std::chrono::steady_clock::now();
    const auto ready = wait_poll_events({{reader.get(), POLLIN}}, 30ms);
    const auto elapsed = std::chrono::steady_clock::now() - started;
    LAB_CHECK(ready.empty());
    LAB_CHECK(elapsed >= 10ms);
    LAB_CHECK(elapsed < 1s);
    LAB_CHECK_THROWS_AS(wait_poll_events({}, -1ms), std::invalid_argument);
}

} // namespace

int main() {
    return systems_lab::run({
        {"reports readable socket", reports_readable_socket},
        {"preserves order and ignores negative fd", preserves_input_order_and_ignores_negative_fd},
        {"exposes hangup and invalid descriptor", exposes_hangup_and_invalid_descriptor},
        {"timeout returns empty", timeout_returns_empty},
    });
}
