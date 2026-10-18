#pragma once

#include "PcmStreamTransform.h"
#include "../core/PcmWorkerSpec.h"

#include <cstdint>
#include <string>
#include <vector>

namespace twilight::audio {

std::unique_ptr<IPcmStreamTransform> createPcmWorkerTransform(PcmWorkerSpec spec);

}  // namespace twilight::audio
