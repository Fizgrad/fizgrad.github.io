#include <arpa/inet.h>
#include <cerrno>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <system_error>
#include <sys/socket.h>

namespace {

void validate_fd(int fd) {
    if (fd < 0) {
        throw std::invalid_argument("fd must be non-negative");
    }
}

void send_all(int fd, const void* data, std::size_t size) {
    const auto* bytes = static_cast<const unsigned char*>(data);
    std::size_t offset = 0;
    while (offset < size) {
        const ssize_t written = ::send(fd, bytes + offset, size - offset, MSG_NOSIGNAL);
        if (written > 0) {
            offset += static_cast<std::size_t>(written);
            continue;
        }
        if (written < 0 && errno == EINTR) {
            continue;
        }
        if (written == 0) {
            throw std::runtime_error("send made no progress");
        }
        throw std::system_error(errno, std::generic_category(), "send");
    }
}

// Returns false only when the peer closes before the first requested byte.
bool receive_exact(int fd, void* data, std::size_t size, bool clean_eof_allowed) {
    auto* bytes = static_cast<unsigned char*>(data);
    std::size_t offset = 0;
    while (offset < size) {
        const ssize_t received = ::recv(fd, bytes + offset, size - offset, 0);
        if (received > 0) {
            offset += static_cast<std::size_t>(received);
            continue;
        }
        if (received == 0) {
            if (offset == 0 && clean_eof_allowed) {
                return false;
            }
            throw std::runtime_error("truncated frame");
        }
        if (errno == EINTR) {
            continue;
        }
        throw std::system_error(errno, std::generic_category(), "recv");
    }
    return true;
}

} // namespace

void send_frame(int fd, std::string_view payload) {
    validate_fd(fd);
    if (payload.size() > std::numeric_limits<std::uint32_t>::max()) {
        throw std::length_error("payload is too large for the wire format");
    }

    const std::uint32_t header = htonl(static_cast<std::uint32_t>(payload.size()));
    send_all(fd, &header, sizeof(header));
    send_all(fd, payload.data(), payload.size());
}

std::optional<std::string> receive_frame(int fd, std::size_t max_payload) {
    validate_fd(fd);
    std::uint32_t network_length = 0;
    if (!receive_exact(fd, &network_length, sizeof(network_length), true)) {
        return std::nullopt;
    }

    const std::size_t length = ntohl(network_length);
    if (length > max_payload) {
        throw std::length_error("frame exceeds max_payload");
    }

    std::string payload(length, '\0');
    receive_exact(fd, payload.data(), payload.size(), false);
    return payload;
}
