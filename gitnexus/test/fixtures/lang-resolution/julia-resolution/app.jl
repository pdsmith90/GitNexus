module App

include("geometry.jl")
using .Geometry: Circle, Square, describe

function scale_circle(c::Circle, factor::Float64)
    return Circle(c.radius * factor)
end

function main()
    c = Circle(2.0)
    bigger = scale_circle(c, 2.0)
    return describe(bigger)
end

end
