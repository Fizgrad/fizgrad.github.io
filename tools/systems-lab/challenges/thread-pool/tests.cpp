#include "linux_test.hpp"
#include "solution.cpp"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstddef>
#include <future>
#include <stdexcept>
#include <thread>
#include <vector>

using namespace std::chrono_literals;

namespace {

void validates_worker_count_and_returns_values() {
    LAB_CHECK_THROWS_AS(ThreadPool(0), std::invalid_argument);
    ThreadPool pool(2);
    LAB_CHECK_EQ(pool.worker_count(), std::size_t{2});
    auto first = pool.submit([] { return 20; });
    auto second = pool.submit([] { return 22; });
    LAB_CHECK_EQ(first.get() + second.get(), 42);
}

void propagates_task_exceptions() {
    ThreadPool pool(1);
    auto result = pool.submit([]() -> int {
        throw std::runtime_error("task failed");
    });
    LAB_CHECK_THROWS_AS(result.get(), std::runtime_error);
}

void runs_tasks_in_parallel() {
    ThreadPool pool(4);
    std::promise<void> release_promise;
    std::shared_future<void> release = release_promise.get_future().share();
    std::atomic<int> active = 0;
    std::atomic<int> maximum = 0;
    std::vector<std::future<int>> results;

    for (int index = 0; index < 4; ++index) {
        results.push_back(pool.submit([&, index] {
            const int current = active.fetch_add(1, std::memory_order_acq_rel) + 1;
            int observed = maximum.load(std::memory_order_relaxed);
            while (observed < current &&
                   !maximum.compare_exchange_weak(observed, current, std::memory_order_relaxed)) {
            }
            release.wait();
            active.fetch_sub(1, std::memory_order_acq_rel);
            return index;
        }));
    }

    const bool reached_parallel_execution = systems_lab::wait_until(
        [&] { return maximum.load(std::memory_order_acquire) >= 2; }, 1s);
    release_promise.set_value();
    int total = 0;
    for (auto& result : results) {
        total += result.get();
    }
    LAB_CHECK(reached_parallel_execution);
    LAB_CHECK_EQ(total, 6);
}

void shutdown_drains_and_rejects_new_work() {
    ThreadPool pool(3);
    std::atomic<int> completed = 0;
    std::vector<std::future<int>> results;
    for (int value = 0; value < 40; ++value) {
        results.push_back(pool.submit([&, value] {
            std::this_thread::sleep_for(1ms);
            completed.fetch_add(1, std::memory_order_relaxed);
            return value;
        }));
    }

    pool.shutdown();
    pool.shutdown();
    LAB_CHECK_EQ(completed.load(std::memory_order_relaxed), 40);
    for (int value = 0; value < 40; ++value) {
        LAB_CHECK_EQ(results[static_cast<std::size_t>(value)].get(), value);
    }
    LAB_CHECK_THROWS_AS(pool.submit([] { return 1; }), std::runtime_error);
}

void destructor_waits_for_accepted_work() {
    std::future<int> result;
    {
        ThreadPool pool(1);
        result = pool.submit([] {
            std::this_thread::sleep_for(20ms);
            return 99;
        });
    }
    LAB_CHECK_EQ(result.get(), 99);
}

} // namespace

int main() {
    return systems_lab::run({
        {"worker count and return values", validates_worker_count_and_returns_values},
        {"task exception propagation", propagates_task_exceptions},
        {"parallel task execution", runs_tasks_in_parallel},
        {"draining and idempotent shutdown", shutdown_drains_and_rejects_new_work},
        {"destructor waits for accepted work", destructor_waits_for_accepted_work},
    });
}
