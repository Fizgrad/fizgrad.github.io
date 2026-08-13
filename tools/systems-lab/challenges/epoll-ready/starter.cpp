#include <chrono>
#include <cstdint>
#include <stdexcept>
#include <vector>

struct EpollResult {
    int fd;
    std::uint32_t events;
};

std::vector<EpollResult> wait_epoll_readable(
    const std::vector<int>& fds,
    std::chrono::milliseconds timeout) {
    (void)fds;
    (void)timeout;
    throw std::logic_error("TODO: implement wait_epoll_readable");
}
