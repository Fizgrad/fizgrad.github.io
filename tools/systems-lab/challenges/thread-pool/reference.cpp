#include <condition_variable>
#include <cstddef>
#include <functional>
#include <future>
#include <mutex>
#include <queue>
#include <stdexcept>
#include <thread>
#include <utility>
#include <vector>

class ThreadPool {
public:
    explicit ThreadPool(std::size_t worker_count) : worker_count_(worker_count) {
        if (worker_count == 0) {
            throw std::invalid_argument("worker_count must be positive");
        }
        workers_.reserve(worker_count_);
        for (std::size_t index = 0; index < worker_count_; ++index) {
            workers_.emplace_back([this] { worker_loop(); });
        }
    }

    ThreadPool(const ThreadPool&) = delete;
    ThreadPool& operator=(const ThreadPool&) = delete;

    ~ThreadPool() { shutdown(); }

    std::future<int> submit(std::function<int()> function) {
        std::packaged_task<int()> task(std::move(function));
        std::future<int> result = task.get_future();
        std::packaged_task<void()> work([task = std::move(task)]() mutable {
            task();
        });

        {
            std::lock_guard lock(mutex_);
            if (!accepting_) {
                throw std::runtime_error("thread pool is shut down");
            }
            tasks_.push(std::move(work));
        }
        work_available_.notify_one();
        return result;
    }

    void shutdown() {
        {
            std::lock_guard lock(mutex_);
            accepting_ = false;
        }
        work_available_.notify_all();
        for (std::thread& worker : workers_) {
            if (worker.joinable()) {
                worker.join();
            }
        }
        workers_.clear();
    }

    [[nodiscard]] std::size_t worker_count() const noexcept {
        return worker_count_;
    }

private:
    void worker_loop() {
        for (;;) {
            std::packaged_task<void()> task;
            {
                std::unique_lock lock(mutex_);
                work_available_.wait(lock, [this] {
                    return !tasks_.empty() || !accepting_;
                });
                if (tasks_.empty()) {
                    return;
                }
                task = std::move(tasks_.front());
                tasks_.pop();
            }
            task();
        }
    }

    const std::size_t worker_count_;
    std::vector<std::thread> workers_;
    std::queue<std::packaged_task<void()>> tasks_;
    std::mutex mutex_;
    std::condition_variable work_available_;
    bool accepting_ = true;
};
