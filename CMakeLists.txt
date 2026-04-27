cmake_minimum_required(VERSION 3.20)
set(CMAKE_POLICY_DEFAULT_CMP0069 NEW)
project(FortressWASM LANGUAGES C CXX)

set(CMAKE_INTERPROCEDURAL_OPTIMIZATION TRUE)

set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

set(CMAKE_POLICY_VERSION_MINIMUM 3.5)

include(cmake/CPM.cmake)
CPMAddPackage(
    "gh:FragrantResult186/cubiomes-bedrock#master"
)

add_executable(fortress
    fortress.cpp
)

target_compile_features(fortress PRIVATE cxx_std_17)

target_compile_options(fortress PRIVATE "-Oz")

set_target_properties(fortress PROPERTIES
    CXX_EXTENSIONS OFF
    SUFFIX ".js"
)

target_include_directories(fortress PRIVATE
    ${cubiomes_SOURCE_DIR}
)

target_link_libraries(fortress PRIVATE
    cubiomes_static
)

target_link_options(fortress PRIVATE
    "-Oz"
    "--bind"
    "-sWASM=1"
    "-sALLOW_MEMORY_GROWTH=1"
    "-sMODULARIZE=1"
    "-sEXPORT_NAME=FortressModule"
    "-sEXPORTED_RUNTIME_METHODS=HEAPF32"
    "-sENVIRONMENT=web,worker"
    "-sSINGLE_FILE=1"
)

add_custom_command(TARGET fortress POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy
        $<TARGET_FILE:fortress>
        ${CMAKE_SOURCE_DIR}/site/

    COMMAND ${CMAKE_COMMAND} -E copy
        $<TARGET_FILE_DIR:fortress>/fortress.wasm
        ${CMAKE_SOURCE_DIR}/site/
)