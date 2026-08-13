#include <chrono>
#include <stdexcept>
#include <vector>

struct PollInterest {
    int fd;
    short events;
};

struct PollResult {
    int fd;
    short revents;
};

std::vector<PollResult> wait_poll_events(
    const std::vector<PollInterest>& interests,
    std::chrono::milliseconds timeout) {
    (void)interests;
    (void)timeout;
    throw std::logic_error("TODO: implement wait_poll_events");
}
