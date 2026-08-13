#include <condition_variable>
#include <cstddef>
#include <functional>
#include <future>
#include <mutex>
#include <queue>
#include <stdexcept>
#include <thread>
#include <vector>

class ThreadPool {
public:
    explicit ThreadPool(std::size_t worker_count) : worker_count_(worker_count) {
        if (worker_count == 0) {
            throw std::invalid_argument("worker_count must be positive");
        }
        // TODO: start worker threads.
    }

    ThreadPool(const ThreadPool&) = delete;
    ThreadPool& operator=(const ThreadPool&) = delete;

    ~ThreadPool() {
        // TODO: make destruction equivalent to a safe shutdown.
    }

    std::future<int> submit(std::function<int()> task) {
        (void)task;
        throw std::logic_error("TODO: implement ThreadPool::submit");
    }

    void shutdown() {
        throw std::logic_error("TODO: implement ThreadPool::shutdown");
    }

    [[nodiscard]] std::size_t worker_count() const noexcept {
        return worker_count_;
    }

private:
    void worker_loop() {
        // TODO: wait for work, execute it outside the lock, and exit after drain.
    }

    const std::size_t worker_count_;
    std::vector<std::thread> workers_;
    std::queue<std::packaged_task<void()>> tasks_;
    std::mutex mutex_;
    std::condition_variable work_available_;
    bool accepting_ = true;
};
