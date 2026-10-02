
#ifndef MICROW8_API_H
#define MICROW8_API_H

typedef int int32_t;

#define IMPORT(MODULE, NAME) \
    __attribute__((import_module(MODULE), import_name(NAME)))

IMPORT("env", "sin") extern float sin(float);
IMPORT("env", "cos") extern float cos(float);
IMPORT("env", "tan") extern float tan(float);
IMPORT("env", "asin") extern float asin(float);
IMPORT("env", "acos") extern float acos(float);
IMPORT("env", "atan") extern float atan(float);
IMPORT("env", "atan2") extern float atan2(float, float);
IMPORT("env", "pow") extern float pow(float, float);
IMPORT("env", "log") extern float log(float);
IMPORT("env", "fmod") extern float fmod(float, float);

IMPORT("env", "random") extern int32_t random(void);
IMPORT("env", "randomf") extern float randomf(void);
IMPORT("env", "randomSeed") extern void randomSeed(int32_t);

IMPORT("env", "cls") extern void cls(int32_t);
IMPORT("env", "setPixel") extern void setPixel(int32_t, int32_t, int32_t);
IMPORT("env", "getPixel") extern int32_t getPixel(int32_t, int32_t);
IMPORT("env", "hline") extern void hline(int32_t, int32_t, int32_t, int32_t);
IMPORT("env", "rectangle") extern void rectangle(float, float, float, float, int32_t);
IMPORT("env", "circle") extern void circle(float, float, float, int32_t);
IMPORT("env", "line") extern void line(float, float, float, float, int32_t);

IMPORT("env", "time") extern float time(void);
IMPORT("env", "isButtonPressed") extern int32_t isButtonPressed(int32_t);
IMPORT("env", "isButtonTriggered") extern int32_t isButtonTriggered(int32_t);

IMPORT("env", "printChar") extern void printChar(int32_t);
IMPORT("env", "printString") extern void printString(int32_t);
IMPORT("env", "printInt") extern void printInt(int32_t);
IMPORT("env", "setTextColor") extern void setTextColor(int32_t);
IMPORT("env", "setBackgroundColor") extern void setBackgroundColor(int32_t);
IMPORT("env", "setCursorPosition") extern void setCursorPosition(int32_t, int32_t);

IMPORT("env", "rectangleOutline") extern void rectangleOutline(float, float, float, float, int32_t);
IMPORT("env", "circleOutline") extern void circleOutline(float, float, float, int32_t);
IMPORT("env", "exp") extern float exp(float);

IMPORT("env", "playNote") extern void playNote(int32_t, int32_t);
IMPORT("env", "sndGes") extern float sndGes(int32_t);

IMPORT("env", "blitSprite") extern void blitSprite(int32_t, int32_t, int32_t, int32_t, int32_t);
IMPORT("env", "grabSprite") extern void grabSprite(int32_t, int32_t, int32_t, int32_t, int32_t);


#define TIME_MS 0x40
#define GAMEPAD 0x44
#define FRAMEBUFFER 0x78
#define PALETTE 0x13000
#define FONT 0x13400
#define USER_MEM 0x14000
#define BUTTON_UP 0x0
#define BUTTON_DOWN 0x1
#define BUTTON_LEFT 0x2
#define BUTTON_RIGHT 0x3
#define BUTTON_A 0x4
#define BUTTON_B 0x5
#define BUTTON_X 0x6
#define BUTTON_Y 0x7

#endif
