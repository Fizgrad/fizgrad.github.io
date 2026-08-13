#include <condition_variable>
#include <cstddef>
#include <deque>
#include <mutex>
#include <optional>
#include <stdexcept>

class BoundedQueue {
public:
    explicit BoundedQueue(std::size_t capacity) : capacity_(capacity) {
        if (capacity == 0) {
            throw std::invalid_argument("capacity must be positive");
        }
    }

    bool push(int value) {
        (void)value;
        throw std::logic_error("TODO: implement BoundedQueue::push");
    }

    std::optional<int> pop() {
        throw std::logic_error("TODO: implement BoundedQueue::pop");
    }

    void close() {
        throw std::logic_error("TODO: implement BoundedQueue::close");
    }

    std::size_t size() const {
        throw std::logic_error("TODO: implement BoundedQueue::size");
    }

private:
    const std::size_t capacity_;
    mutable std::mutex mutex_;
    std::condition_variable not_empty_;
    std::condition_variable not_full_;
    std::deque<int> values_;
    bool closed_ = false;
};
