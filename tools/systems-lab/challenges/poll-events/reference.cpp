#include <algorithm>
#include <cerrno>
#include <chrono>
#include <climits>
#include <cstdint>
#include <poll.h>
#include <stdexcept>
#include <system_error>
#include <vector>

struct PollInterest {
    int fd;
    short events;
};

struct PollResult {
    int fd;
    short revents;
};

namespace {

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

std::vector<PollResult> wait_poll_events(
    const std::vector<PollInterest>& interests,
    std::chrono::milliseconds timeout) {
    if (timeout < std::chrono::milliseconds::zero()) {
        throw std::invalid_argument("timeout must be non-negative");
    }

    std::vector<pollfd> descriptors;
    descriptors.reserve(interests.size());
    for (const PollInterest& interest : interests) {
        descriptors.push_back(pollfd{interest.fd, interest.events, 0});
    }

    const auto deadline = std::chrono::steady_clock::now() + timeout;
    for (;;) {
        for (pollfd& descriptor : descriptors) {
            descriptor.revents = 0;
        }
        const int result = ::poll(
            descriptors.data(),
            static_cast<nfds_t>(descriptors.size()),
            remaining_milliseconds(deadline));
        if (result > 0) {
            std::vector<PollResult> ready;
            for (const pollfd& descriptor : descriptors) {
                if (descriptor.revents != 0) {
                    ready.push_back(PollResult{descriptor.fd, descriptor.revents});
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
        throw std::system_error(errno, std::generic_category(), "poll");
    }
}
