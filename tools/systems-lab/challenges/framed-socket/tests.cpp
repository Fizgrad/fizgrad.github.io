#include "linux_test.hpp"
#include "solution.cpp"

#include <arpa/inet.h>
#include <chrono>
#include <cstdint>
#include <exception>
#include <optional>
#include <stdexcept>
#include <string>
#include <sys/socket.h>
#include <thread>
#include <unistd.h>

using namespace std::chrono_literals;

namespace {

void sends_and_receives_normal_and_empty_frames() {
    auto sockets = systems_lab::make_socket_pair();
    send_frame(sockets.first.get(), "hello");
    send_frame(sockets.first.get(), "");
    LAB_CHECK_EQ(receive_frame(sockets.second.get(), 64).value(), std::string("hello"));
    LAB_CHECK_EQ(receive_frame(sockets.second.get(), 64).value(), std::string());
}

void accepts_fragmented_header_and_body() {
    auto sockets = systems_lab::make_socket_pair();
    const std::string payload = "fragmented payload";
    const std::uint32_t header = htonl(static_cast<std::uint32_t>(payload.size()));
    const auto* header_bytes = reinterpret_cast<const unsigned char*>(&header);

    std::thread writer([&] {
        systems_lab::write_all_fd(sockets.first.get(), header_bytes, 1);
        std::this_thread::sleep_for(2ms);
        systems_lab::write_all_fd(sockets.first.get(), header_bytes + 1, 3);
        systems_lab::write_all_fd(sockets.first.get(), payload.data(), 4);
        std::this_thread::sleep_for(2ms);
        systems_lab::write_all_fd(sockets.first.get(), payload.data() + 4, payload.size() - 4);
    });

    const auto result = receive_frame(sockets.second.get(), 128);
    writer.join();
    LAB_CHECK(result.has_value());
    LAB_CHECK_EQ(result.value(), payload);
}

void distinguishes_clean_eof_from_truncation() {
    {
        auto sockets = systems_lab::make_socket_pair();
        sockets.first.reset();
        LAB_CHECK(!receive_frame(sockets.second.get(), 64).has_value());
    }
    {
        auto sockets = systems_lab::make_socket_pair();
        const std::uint16_t partial_header = 0;
        systems_lab::write_all_fd(sockets.first.get(), &partial_header, sizeof(partial_header));
        sockets.first.reset();
        LAB_CHECK_THROWS_AS(receive_frame(sockets.second.get(), 64), std::runtime_error);
    }
    {
        auto sockets = systems_lab::make_socket_pair();
        const std::uint32_t header = htonl(10);
        systems_lab::write_all_fd(sockets.first.get(), &header, sizeof(header));
        systems_lab::write_all_fd(sockets.first.get(), "abc", 3);
        sockets.first.reset();
        LAB_CHECK_THROWS_AS(receive_frame(sockets.second.get(), 64), std::runtime_error);
    }
}

void enforces_length_limit_before_reading_payload() {
    auto sockets = systems_lab::make_socket_pair();
    const std::uint32_t header = htonl(1024);
    systems_lab::write_all_fd(sockets.first.get(), &header, sizeof(header));
    LAB_CHECK_THROWS_AS(receive_frame(sockets.second.get(), 32), std::length_error);
    LAB_CHECK_THROWS_AS(receive_frame(-1, 32), std::invalid_argument);
    LAB_CHECK_THROWS_AS(send_frame(-1, "x"), std::invalid_argument);
}

void transfers_a_payload_larger_than_the_socket_buffer() {
    auto sockets = systems_lab::make_socket_pair();
    const std::string payload(2 * 1024 * 1024, 'x');
    std::exception_ptr sender_error;
    std::thread sender([&] {
        try {
            send_frame(sockets.first.get(), payload);
        } catch (...) {
            sender_error = std::current_exception();
        }
    });

    const auto result = receive_frame(sockets.second.get(), payload.size());
    sender.join();
    if (sender_error) {
        std::rethrow_exception(sender_error);
    }
    LAB_CHECK(result.has_value());
    LAB_CHECK_EQ(result->size(), payload.size());
    LAB_CHECK_EQ(*result, payload);
}

void suppresses_sigpipe_when_the_peer_is_closed() {
    auto sockets = systems_lab::make_socket_pair();
    sockets.second.reset();
    LAB_CHECK_THROWS_AS(send_frame(sockets.first.get(), "peer is gone"), std::system_error);
}

} // namespace

int main() {
    return systems_lab::run({
        {"normal and empty frames", sends_and_receives_normal_and_empty_frames},
        {"fragmented header and body", accepts_fragmented_header_and_body},
        {"clean EOF and truncation", distinguishes_clean_eof_from_truncation},
        {"length limit", enforces_length_limit_before_reading_payload},
        {"large payload", transfers_a_payload_larger_than_the_socket_buffer},
        {"SIGPIPE suppression", suppresses_sigpipe_when_the_peer_is_closed},
    });
}
