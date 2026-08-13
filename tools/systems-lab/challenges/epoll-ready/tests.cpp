#include "linux_test.hpp"
#include "solution.cpp"

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <stdexcept>
#include <sys/epoll.h>
#include <vector>

using namespace std::chrono_literals;
using systems_lab::make_socket_pair;

namespace {

void reports_one_and_multiple_ready_sockets() {
    auto [local_one, peer_one] = make_socket_pair();
    auto [local_two, peer_two] = make_socket_pair();
    systems_lab::write_all_fd(peer_two.get(), "two");

    auto ready = wait_epoll_readable({local_one.get(), local_two.get()}, 200ms);
    LAB_CHECK_EQ(ready.size(), std::size_t{1});
    LAB_CHECK_EQ(ready[0].fd, local_two.get());
    LAB_CHECK((ready[0].events & EPOLLIN) != 0U);

    systems_lab::write_all_fd(peer_one.get(), "one");
    ready = wait_epoll_readable({local_two.get(), local_one.get()}, 200ms);
    LAB_CHECK_EQ(ready.size(), std::size_t{2});
    LAB_CHECK(ready[0].fd < ready[1].fd);
}

void reports_peer_close() {
    auto [local, peer] = make_socket_pair();
    peer.reset();
    const auto ready = wait_epoll_readable({local.get()}, 200ms);
    LAB_CHECK_EQ(ready.size(), std::size_t{1});
    LAB_CHECK((ready[0].events & (EPOLLRDHUP | EPOLLHUP)) != 0U);
}

void validates_inputs_and_timeout() {
    LAB_CHECK_THROWS_AS(wait_epoll_readable({}, -1ms), std::invalid_argument);
    LAB_CHECK_THROWS_AS(wait_epoll_readable({-1}, 0ms), std::invalid_argument);

    auto [local, peer] = make_socket_pair();
    (void)peer;
    LAB_CHECK_THROWS_AS(
        wait_epoll_readable({local.get(), local.get()}, 0ms), std::invalid_argument);
    LAB_CHECK(wait_epoll_readable({local.get()}, 20ms).empty());
}

void does_not_leak_epoll_descriptors() {
    auto [local, peer] = make_socket_pair();
    (void)peer;
    const std::size_t before = systems_lab::count_open_descriptors();
    for (int iteration = 0; iteration < 64; ++iteration) {
        LAB_CHECK(wait_epoll_readable({local.get()}, 0ms).empty());
    }
    const std::size_t after = systems_lab::count_open_descriptors();
    LAB_CHECK_EQ(after, before);
}

} // namespace

int main() {
    return systems_lab::run({
        {"reports one and multiple ready sockets", reports_one_and_multiple_ready_sockets},
        {"reports peer close", reports_peer_close},
        {"validates inputs and timeout", validates_inputs_and_timeout},
        {"does not leak epoll descriptors", does_not_leak_epoll_descriptors},
    });
}
