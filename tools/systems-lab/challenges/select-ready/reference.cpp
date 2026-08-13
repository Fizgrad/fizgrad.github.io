#include <algorithm>
#include <cerrno>
#include <chrono>
#include <stdexcept>
#include <system_error>
#include <sys/select.h>
#include <vector>

namespace {

timeval remaining_timeval(std::chrono::steady_clock::time_point deadline) {
    using namespace std::chrono;
    const auto now = steady_clock::now();
    auto remaining = duration_cast<microseconds>(deadline - now);
    if (remaining < microseconds::zero()) {
        remaining = microseconds::zero();
    }
    timeval result{};
    result.tv_sec = static_cast<decltype(result.tv_sec)>(remaining.count() / 1'000'000);
    result.tv_usec = static_cast<decltype(result.tv_usec)>(remaining.count() % 1'000'000);
    return result;
}

} // namespace

std::vector<int> wait_readable_select(
    const std::vector<int>& fds,
    std::chrono::milliseconds timeout) {
    if (timeout < std::chrono::milliseconds::zero()) {
        throw std::invalid_argument("timeout must be non-negative");
    }

    std::vector<int> unique = fds;
    std::sort(unique.begin(), unique.end());
    unique.erase(std::unique(unique.begin(), unique.end()), unique.end());

    int maximum = -1;
    for (int fd : unique) {
        if (fd < 0 || fd >= FD_SETSIZE) {
            throw std::invalid_argument("fd is outside select's supported range");
        }
        maximum = std::max(maximum, fd);
    }

    const auto deadline = std::chrono::steady_clock::now() + timeout;
    for (;;) {
        fd_set readable;
        FD_ZERO(&readable);
        for (int fd : unique) {
            FD_SET(fd, &readable);
        }

        timeval wait = remaining_timeval(deadline);
        const int result = ::select(maximum + 1, &readable, nullptr, nullptr, &wait);
        if (result > 0) {
            std::vector<int> ready;
            for (int fd : unique) {
                if (FD_ISSET(fd, &readable)) {
                    ready.push_back(fd);
                }
            }
            return ready;
        }
        if (result == 0) {
            return {};
        }
        if (errno == EINTR) {
            if (std::chrono::steady_clock::now() >= deadline) {
                return {};
            }
            continue;
        }
        throw std::system_error(errno, std::generic_category(), "select");
    }
}
