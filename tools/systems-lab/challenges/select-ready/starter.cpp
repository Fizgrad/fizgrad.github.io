#include <chrono>
#include <stdexcept>
#include <vector>

std::vector<int> wait_readable_select(
    const std::vector<int>& fds,
    std::chrono::milliseconds timeout) {
    (void)fds;
    (void)timeout;
    throw std::logic_error("TODO: implement wait_readable_select");
}
