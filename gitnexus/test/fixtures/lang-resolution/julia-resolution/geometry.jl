module Geometry

abstract type Shape end

struct Circle <: Shape
    radius::Float64
end

struct Square <: Shape
    side::Float64
end

# Parametric heads: nodes are named by the base type (`Box`), never `Box{T}`.
abstract type Container{T} <: Shape end

mutable struct Box{T<:Real} <: Container{T}
    content::T
end

struct Tag <: Container{Int}
    label::String
end

# Multiple dispatch: two methods of the generic function `area`.
area(c::Circle) = 3.14159 * c.radius^2
area(s::Square) = s.side * s.side

function describe(shape::Shape)
    return area(shape)
end

macro logshape(x)
    return :( println($x) )
end

end
