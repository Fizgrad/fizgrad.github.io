#include <algorithm>
#include <cerrno>
#include <chrono>
#include <climits>
#include <cstdint>
#include <stdexcept>
#include <system_error>
#include <sys/epoll.h>
#include <unistd.h>
#include <unordered_set>
#include <vector>

struct EpollResult {
    int fd;
    std::uint32_t events;
};

namespace {

class EpollFd {
public:
    EpollFd() : fd_(::epoll_create1(EPOLL_CLOEXEC)) {
        if (fd_ == -1) {
            throw std::system_error(errno, std::generic_category(), "epoll_create1");
        }
    }

    EpollFd(const EpollFd&) = delete;
    EpollFd& operator=(const EpollFd&) = delete;

    ~EpollFd() {
        if (fd_ >= 0) {
            ::close(fd_);
        }
    }

    [[nodiscard]] int get() const noexcept { return fd_; }

private:
    int fd_;
};

int remaining_milliseconds(std::chrono::steady_clock::time_point deadline) {
    using namespace std::chrono;
    const auto remaining = deadline - steady_clock::now();
    if (remaining <= steady_clock::duration::zero()) {
        return 0;
    }
    const auto rounded = duration_cast<milliseconds>(remaining + microseconds(999));
    return static_cast<int>(std::min<std::int64_t>(rounded.count(), INT_MAX));
}

} // namespace

std::vector<EpollResult> wait_epoll_readable(
    const std::vector<int>& fds,
    std::chrono::milliseconds timeout) {
    if (timeout < std::chrono::milliseconds::zero()) {
        throw std::invalid_argument("timeout must be non-negative");
    }

    std::unordered_set<int> seen;
    EpollFd epoll;
    for (int fd : fds) {
        if (fd < 0) {
            throw std::invalid_argument("fd must be non-negative");
        }
        if (!seen.insert(fd).second) {
            throw std::invalid_argument("duplicate fd");
        }
        epoll_event event{};
        event.events = EPOLLIN | EPOLLRDHUP | EPOLLHUP | EPOLLERR;
        event.data.fd = fd;
        if (::epoll_ctl(epoll.get(), EPOLL_CTL_ADD, fd, &event) == -1) {
            throw std::system_error(errno, std::generic_category(), "epoll_ctl(ADD)");
        }
    }

    std::vector<epoll_event> events(std::max<std::size_t>(1, fds.size()));
    const auto deadline = std::chrono::steady_clock::now() + timeout;
    for (;;) {
        const int count = ::epoll_wait(
            epoll.get(),
            events.data(),
            static_cast<int>(events.size()),
            remaining_milliseconds(deadline));
        if (count > 0) {
            std::vector<EpollResult> ready;
            ready.reserve(static_cast<std::size_t>(count));
            for (int index = 0; index < count; ++index) {
                ready.push_back(EpollResult{events[index].data.fd, events[index].events});
            }
            std::sort(ready.begin(), ready.end(), [](const auto& left, const auto& right) {
                return left.fd < right.fd;
            });
            return ready;
        }
        if (count == 0) {
            return {};
        }
        if (errno == EINTR) {
            if (std::chrono::steady_clock::now() >= deadline) {
                return {};
            }
            continue;
        }
        throw std::system_error(errno, std::generic_category(), "epoll_wait");
    }
}
