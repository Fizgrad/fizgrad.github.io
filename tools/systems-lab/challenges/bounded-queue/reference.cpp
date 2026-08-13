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
        std::unique_lock lock(mutex_);
        not_full_.wait(lock, [this] { return closed_ || values_.size() < capacity_; });
        if (closed_) {
            return false;
        }
        values_.push_back(value);
        lock.unlock();
        not_empty_.notify_one();
        return true;
    }

    std::optional<int> pop() {
        std::unique_lock lock(mutex_);
        not_empty_.wait(lock, [this] { return closed_ || !values_.empty(); });
        if (values_.empty()) {
            return std::nullopt;
        }
        const int value = values_.front();
        values_.pop_front();
        lock.unlock();
        not_full_.notify_one();
        return value;
    }

    void close() {
        {
            std::lock_guard lock(mutex_);
            closed_ = true;
        }
        not_empty_.notify_all();
        not_full_.notify_all();
    }

    std::size_t size() const {
        std::lock_guard lock(mutex_);
        return values_.size();
    }

private:
    const std::size_t capacity_;
    mutable std::mutex mutex_;
    std::condition_variable not_empty_;
    std::condition_variable not_full_;
    std::deque<int> values_;
    bool closed_ = false;
};
