#include <cstddef>
#include <optional>
#include <string>
#include <string_view>

// Wire format: 4-byte unsigned big-endian payload length, followed by payload.
void send_frame(int fd, std::string_view payload) {
    // TODO: loop until the header and payload are fully sent. Handle EINTR,
    // short writes, SIGPIPE, invalid input, and system-call errors.
    (void)fd;
    (void)payload;
}

std::optional<std::string> receive_frame(int fd, std::size_t max_payload) {
    // TODO: return nullopt only for a clean EOF before any header byte. A
    // truncated header/body is a protocol error, not a clean EOF.
    (void)fd;
    (void)max_payload;
    return std::nullopt;
}
