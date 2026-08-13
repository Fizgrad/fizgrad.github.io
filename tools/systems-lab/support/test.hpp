#pragma once

#include <exception>
#include <functional>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace systems_lab {

class TestFailure : public std::runtime_error {
public:
    using std::runtime_error::runtime_error;
};

inline std::string location(const char* file, int line) {
    std::ostringstream output;
    output << file << ':' << line;
    return output.str();
}

inline void check(bool condition, const char* expression, const char* file, int line) {
    if (!condition) {
        throw TestFailure(location(file, line) + ": check failed: " + expression);
    }
}

template <typename Left, typename Right>
void check_equal(
    const Left& left,
    const Right& right,
    const char* left_expression,
    const char* right_expression,
    const char* file,
    int line) {
    if (!(left == right)) {
        std::ostringstream output;
        output << location(file, line) << ": expected " << left_expression << " == "
               << right_expression << ", got " << left << " and " << right;
        throw TestFailure(output.str());
    }
}

template <typename Exception, typename Function>
void check_throws(
    Function&& function,
    const char* expression,
    const char* exception_name,
    const char* file,
    int line) {
    try {
        std::forward<Function>(function)();
    } catch (const Exception&) {
        return;
    } catch (const std::exception& error) {
        throw TestFailure(
            location(file, line) + ": " + expression + " threw a different exception: " +
            error.what());
    } catch (...) {
        throw TestFailure(
            location(file, line) + ": " + expression + " threw a non-standard exception");
    }
    throw TestFailure(
        location(file, line) + ": " + expression + " did not throw " + exception_name);
}

struct TestCase {
    std::string name;
    std::function<void()> body;
};

inline int run(std::initializer_list<TestCase> tests) {
    std::size_t passed = 0;
    for (const auto& test : tests) {
        try {
            test.body();
            ++passed;
            std::cout << "[PASS] " << test.name << '\n';
        } catch (const std::exception& error) {
            std::cerr << "[FAIL] " << test.name << "\n       " << error.what() << '\n';
            return 1;
        } catch (...) {
            std::cerr << "[FAIL] " << test.name << "\n       unknown exception\n";
            return 1;
        }
    }
    std::cout << "[SUMMARY] " << passed << '/' << tests.size() << " checks passed\n";
    return 0;
}

} // namespace systems_lab

#define LAB_CHECK(expression) \
    ::systems_lab::check(static_cast<bool>(expression), #expression, __FILE__, __LINE__)

#define LAB_CHECK_EQ(left, right) \
    ::systems_lab::check_equal((left), (right), #left, #right, __FILE__, __LINE__)

#define LAB_CHECK_THROWS_AS(expression, exception_type)                            \
    ::systems_lab::check_throws<exception_type>(                                  \
        [&] { static_cast<void>(expression); }, #expression, #exception_type,      \
        __FILE__, __LINE__)
