#pragma once

#include "test.hpp"

#include <array>
#include <cerrno>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <dirent.h>
#include <fcntl.h>
#include <functional>
#include <stdexcept>
#include <string>
#include <system_error>
#include <sys/socket.h>
#include <thread>
#include <unistd.h>
#include <utility>

namespace systems_lab {

class UniqueFd {
public:
    UniqueFd() = default;
    explicit UniqueFd(int fd) noexcept : fd_(fd) {}

    UniqueFd(const UniqueFd&) = delete;
    UniqueFd& operator=(const UniqueFd&) = delete;

    UniqueFd(UniqueFd&& other) noexcept : fd_(other.release()) {}

    UniqueFd& operator=(UniqueFd&& other) noexcept {
        if (this != &other) {
            reset(other.release());
        }
        return *this;
    }

    ~UniqueFd() { reset(); }

    [[nodiscard]] int get() const noexcept { return fd_; }
    [[nodiscard]] explicit operator bool() const noexcept { return fd_ >= 0; }

    int release() noexcept {
        const int result = fd_;
        fd_ = -1;
        return result;
    }

    void reset(int replacement = -1) noexcept {
        if (fd_ == replacement) {
            return;
        }
        const int previous = fd_;
        fd_ = replacement;
        if (previous >= 0) {
            // On Linux the descriptor is released even if close reports EINTR;
            // retrying could close an unrelated descriptor that reused the number.
            ::close(previous);
        }
    }

private:
    int fd_ = -1;
};

inline std::pair<UniqueFd, UniqueFd> make_pipe() {
    std::array<int, 2> descriptors{};
    if (::pipe2(descriptors.data(), O_CLOEXEC) == -1) {
        throw std::system_error(errno, std::generic_category(), "pipe2");
    }
    return {UniqueFd(descriptors[0]), UniqueFd(descriptors[1])};
}

inline std::pair<UniqueFd, UniqueFd> make_socket_pair() {
    std::array<int, 2> descriptors{};
    if (::socketpair(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0, descriptors.data()) == -1) {
        throw std::system_error(errno, std::generic_category(), "socketpair");
    }
    return {UniqueFd(descriptors[0]), UniqueFd(descriptors[1])};
}

inline void write_all_fd(int fd, const void* data, std::size_t size) {
    const auto* bytes = static_cast<const std::byte*>(data);
    std::size_t written = 0;
    while (written < size) {
        const ssize_t result = ::write(fd, bytes + written, size - written);
        if (result > 0) {
            written += static_cast<std::size_t>(result);
            continue;
        }
        if (result == -1 && errno == EINTR) {
            continue;
        }
        throw std::system_error(
            result == -1 ? errno : EIO, std::generic_category(), "write");
    }
}

inline void write_all_fd(int fd, const std::string& text) {
    write_all_fd(fd, text.data(), text.size());
}

inline void set_nonblocking(int fd) {
    const int flags = ::fcntl(fd, F_GETFL);
    if (flags == -1 || ::fcntl(fd, F_SETFL, flags | O_NONBLOCK) == -1) {
        throw std::system_error(errno, std::generic_category(), "fcntl(O_NONBLOCK)");
    }
}

inline std::size_t count_open_descriptors() {
    DIR* directory = ::opendir("/proc/self/fd");
    if (directory == nullptr) {
        throw std::system_error(errno, std::generic_category(), "opendir(/proc/self/fd)");
    }

    std::size_t count = 0;
    while (dirent* entry = ::readdir(directory)) {
        const std::string name = entry->d_name;
        if (name != "." && name != "..") {
            ++count;
        }
    }
    ::closedir(directory);
    return count;
}

template <typename Predicate>
bool wait_until(Predicate&& predicate, std::chrono::milliseconds timeout) {
    const auto deadline = std::chrono::steady_clock::now() + timeout;
    while (std::chrono::steady_clock::now() < deadline) {
        if (std::invoke(predicate)) {
            return true;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    return std::invoke(predicate);
}

} // namespace systems_lab
