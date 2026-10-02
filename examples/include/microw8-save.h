#ifndef MICROW8_SAVE_H
#define MICROW8_SAVE_H
#include <stdint.h>
#define UW8_SAVE_MAX 65536
#define UW8_SAVE_NOT_FOUND (-1)
#define UW8_SAVE_INVALID (-2)
#define UW8_SAVE_BUFFER_SMALL (-3)
#define UW8_SAVE_TOO_LARGE (-4)
#define UW8_SAVE_UNAVAILABLE (-5)
#define UW8_SAVE_IO_ERROR (-6)
#define UW8_SAVE_CORRUPT (-7)
#define UW8_SAVE_CONFLICT (-8)
#define UW8_SAVE_DENIED (-9)
#define UW8_SAVE_IMPORT(name) __attribute__((import_module("env"), import_name(name)))
UW8_SAVE_IMPORT("saveSize") int32_t saveSize(void);
UW8_SAVE_IMPORT("saveRead") int32_t saveRead(void *dst, int32_t capacity);
UW8_SAVE_IMPORT("saveWrite") int32_t saveWrite(const void *src, int32_t length);
UW8_SAVE_IMPORT("saveDelete") int32_t saveDelete(void);
#endif
