
;; Host save extension (not part of the v1 base table)
(import "env" "saveSize" (func $saveSize (result i32)))
(import "env" "saveRead" (func $saveRead (param i32 i32) (result i32)))
(import "env" "saveWrite" (func $saveWrite (param i32 i32) (result i32)))
(import "env" "saveDelete" (func $saveDelete (result i32)))
