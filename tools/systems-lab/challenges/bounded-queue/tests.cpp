#include "linux_test.hpp"
#include "solution.cpp"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstddef>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <thread>
#include <vector>

using namespace std::chrono_literals;

namespace {

void fifo_capacity_and_close_semantics() {
    LAB_CHECK_THROWS_AS(BoundedQueue(0), std::invalid_argument);

    BoundedQueue queue(2);
    LAB_CHECK(queue.push(10));
    LAB_CHECK(queue.push(20));
    LAB_CHECK_EQ(queue.size(), std::size_t{2});
    LAB_CHECK_EQ(queue.pop().value(), 10);
    queue.close();
    queue.close();
    LAB_CHECK(!queue.push(30));
    LAB_CHECK_EQ(queue.pop().value(), 20);
    LAB_CHECK(!queue.pop().has_value());
}

void pop_blocks_until_an_item_arrives() {
    BoundedQueue queue(1);
    std::atomic<bool> started = false;
    std::atomic<bool> finished = false;
    std::optional<int> result;

    std::thread consumer([&] {
        started.store(true, std::memory_order_release);
        result = queue.pop();
        finished.store(true, std::memory_order_release);
    });

    LAB_CHECK(systems_lab::wait_until(
        [&] { return started.load(std::memory_order_acquire); }, 500ms));
    std::this_thread::sleep_for(20ms);
    const bool was_blocked = !finished.load(std::memory_order_acquire);
    LAB_CHECK(queue.push(42));
    consumer.join();

    LAB_CHECK(was_blocked);
    LAB_CHECK(result.has_value());
    LAB_CHECK_EQ(*result, 42);
}

void push_blocks_until_space_and_close_wakes_waiters() {
    BoundedQueue queue(1);
    LAB_CHECK(queue.push(1));
    std::atomic<bool> started = false;
    std::atomic<bool> finished = false;
    bool pushed = true;

    std::thread producer([&] {
        started.store(true, std::memory_order_release);
        pushed = queue.push(2);
        finished.store(true, std::memory_order_release);
    });

    LAB_CHECK(systems_lab::wait_until(
        [&] { return started.load(std::memory_order_acquire); }, 500ms));
    std::this_thread::sleep_for(20ms);
    const bool was_blocked = !finished.load(std::memory_order_acquire);
    queue.close();
    producer.join();

    LAB_CHECK(was_blocked);
    LAB_CHECK(!pushed);
    LAB_CHECK_EQ(queue.pop().value(), 1);
    LAB_CHECK(!queue.pop().has_value());

    BoundedQueue empty(1);
    std::optional<int> result = 7;
    std::thread consumer([&] { result = empty.pop(); });
    std::this_thread::sleep_for(20ms);
    empty.close();
    consumer.join();
    LAB_CHECK(!result.has_value());
}

void multiple_producers_and_consumers_preserve_every_value() {
    constexpr int producer_count = 4;
    constexpr int consumer_count = 4;
    constexpr int values_per_producer = 300;
    BoundedQueue queue(17);
    std::mutex received_mutex;
    std::vector<int> received;
    received.reserve(producer_count * values_per_producer);

    std::vector<std::thread> consumers;
    for (int index = 0; index < consumer_count; ++index) {
        consumers.emplace_back([&] {
            while (std::optional<int> value = queue.pop()) {
                std::lock_guard lock(received_mutex);
                received.push_back(*value);
            }
        });
    }

    std::vector<std::thread> producers;
    for (int producer = 0; producer < producer_count; ++producer) {
        producers.emplace_back([&, producer] {
            for (int offset = 0; offset < values_per_producer; ++offset) {
                LAB_CHECK(queue.push(producer * values_per_producer + offset));
            }
        });
    }

    for (std::thread& producer : producers) {
        producer.join();
    }
    queue.close();
    for (std::thread& consumer : consumers) {
        consumer.join();
    }

    std::sort(received.begin(), received.end());
    LAB_CHECK_EQ(received.size(), std::size_t{producer_count * values_per_producer});
    for (int expected = 0; expected < producer_count * values_per_producer; ++expected) {
        LAB_CHECK_EQ(received[static_cast<std::size_t>(expected)], expected);
    }
}

} // namespace

int main() {
    return systems_lab::run({
        {"FIFO, capacity, and close semantics", fifo_capacity_and_close_semantics},
        {"pop blocks until an item arrives", pop_blocks_until_an_item_arrives},
        {"push blocks and close wakes waiters", push_blocks_until_space_and_close_wakes_waiters},
        {"multiple producers and consumers", multiple_producers_and_consumers_preserve_every_value},
    });
}
