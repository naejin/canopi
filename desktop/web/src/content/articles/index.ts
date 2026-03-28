export interface Article {
  id: string
  title: string       // i18n key under learning.*
  topic: string       // topic tag key
  content: string     // markdown (English only for MVP)
  relatedPlants?: string[]  // canonical names
}

export const articles: Article[] = [
  {
    id: 'companion-planting-basics',
    title: 'Companion Planting Basics',
    topic: 'companionPlanting',
    content: `# Companion Planting Basics

Companion planting is the practice of growing certain plants near each other to achieve mutual benefits such as pest control, pollination support, and improved nutrient uptake. It draws on centuries of indigenous agricultural knowledge combined with modern ecological research.

## The Three Sisters

Perhaps the most famous example is the Three Sisters guild used by Indigenous peoples of the Americas. Corn provides a tall stalk for beans to climb. Beans fix atmospheric nitrogen into the soil, feeding the corn and squash. Squash spreads its broad leaves across the ground, suppressing weeds and retaining soil moisture.

## Key Principles

- **Pest confusion**: Aromatic herbs like basil, dill, and cilantro mask the scent of crops, making it harder for pest insects to locate their target plants.
- **Trap cropping**: Nasturtiums attract aphids away from brassicas. Sunflowers lure stink bugs away from tomatoes.
- **Nutrient sharing**: Deep-rooted plants like comfrey mine minerals from subsoil and make them available to shallow-rooted neighbours through leaf mulch.
- **Structural support**: Tall plants provide shade for heat-sensitive crops. Wind-tolerant species shelter tender seedlings.

## Getting Started

Begin with well-documented pairings: tomatoes with basil, carrots with onions, or corn with beans. Observe your garden closely over a full season before scaling up. Keep a journal of what works in your specific microclimate and soil.`,
    relatedPlants: [
      'Zea mays',
      'Phaseolus vulgaris',
      'Cucurbita maxima',
      'Ocimum basilicum',
      'Tropaeolum majus',
    ],
  },
  {
    id: 'composting-101',
    title: 'Composting 101',
    topic: 'composting',
    content: `# Composting 101

Composting transforms organic waste into nutrient-rich humus that improves soil structure, feeds soil biology, and reduces landfill contributions. It is the foundation of any closed-loop agroecological system.

## The Carbon-to-Nitrogen Ratio

Effective composting balances carbon-rich "browns" (dried leaves, straw, cardboard) with nitrogen-rich "greens" (kitchen scraps, fresh grass clippings, manure). A ratio of roughly 25-30 parts carbon to 1 part nitrogen by weight creates ideal conditions for microbial decomposition.

## Methods

- **Hot composting**: Build a pile at least 1 cubic metre. Turn it every few days to maintain temperatures of 55-65 C. Finished compost in 4-8 weeks.
- **Cold composting**: Add materials as they become available. No turning required. Takes 6-12 months but preserves more fungal networks.
- **Vermicomposting**: Red wiggler worms (Eisenia fetida) process food scraps in bins. Excellent for small spaces and produces nutrient-dense worm castings.
- **Bokashi**: Anaerobic fermentation using inoculated bran. Processes meat and dairy that other methods cannot. The fermented material is then buried in soil.

## Troubleshooting

If your pile smells like ammonia, add more browns. If it is not heating up, add more greens and ensure adequate moisture (like a wrung-out sponge). Avoid adding diseased plant material, pet waste, or treated wood.

## Using Finished Compost

Apply 2-5 cm as a top dressing around perennials, or work it into beds before planting annuals. Compost tea (steeped in water with aeration) provides a liquid feed for foliar application.`,
    relatedPlants: [
      'Symphytum officinale',
      'Urtica dioica',
    ],
  },
  {
    id: 'water-management-permaculture',
    title: 'Water Management in Permaculture',
    topic: 'waterManagement',
    content: `# Water Management in Permaculture

Water is the most critical resource in any landscape design. Permaculture water management follows a simple hierarchy: slow it, spread it, sink it. The goal is to capture rainfall where it falls and store it in the soil rather than letting it run off.

## Reading the Landscape

Before designing water systems, observe your site during and after rain. Where does water flow? Where does it pool? Where does the soil dry out fastest? These observations reveal the natural drainage patterns you can work with rather than against.

## Earthworks

- **Swales**: Level ditches dug along contour lines. Water collects in the swale and slowly infiltrates into the soil downhill, creating a moist zone ideal for tree planting.
- **Berms**: The raised mound of soil on the downhill side of a swale. Plant fruit trees and perennials here to benefit from sub-surface moisture.
- **Keyline plowing**: Shallow ripping along a modified contour pattern that moves water from valleys to ridges, evening out soil moisture across the landscape.

## Mulch as Water Storage

A 10-15 cm layer of organic mulch can reduce evaporation by up to 70%. Wood chips, straw, and leaf litter all work well. Living mulches (ground cover plants) provide the same benefit plus root exudates that feed soil life.

## Rainwater Harvesting

A 100 square metre roof in a region receiving 600 mm of annual rainfall can capture 60,000 litres per year. Simple tank systems with first-flush diverters provide clean water for irrigation throughout dry periods.

## Plant Selection

Choose drought-adapted species for exposed areas and moisture-loving plants for swale zones. Match plant water needs to the moisture gradient your earthworks create.`,
    relatedPlants: [
      'Symphytum officinale',
      'Vetiveria zizanioides',
      'Salix alba',
    ],
  },
  {
    id: 'understanding-soil-health',
    title: 'Understanding Soil Health',
    topic: 'soilHealth',
    content: `# Understanding Soil Health

Healthy soil is a living ecosystem. A single teaspoon of productive soil contains more microorganisms than there are people on Earth. These bacteria, fungi, protozoa, and nematodes form the biological engine that drives plant nutrition and disease resistance.

## The Soil Food Web

Plants release up to 40% of their photosynthetic carbon as root exudates, feeding specific communities of soil microbes. In return, mycorrhizal fungi extend the root network by orders of magnitude, delivering phosphorus, zinc, and water to the plant. Bacteria solubilize minerals locked in rock particles. This reciprocal exchange is the foundation of natural fertility.

## Indicators of Healthy Soil

- **Earthy smell**: The scent of geosmin, produced by beneficial actinobacteria
- **Crumbly aggregates**: Soil that holds its shape when squeezed but crumbles when poked
- **Earthworm activity**: 10+ worms per spadeful indicates good biological function
- **Diverse plant cover**: Healthy soil supports diverse plant communities, not just dominant species
- **Water infiltration**: Water should soak in within seconds, not pool on the surface

## Building Soil Health

1. **Stop tilling**: Tillage breaks fungal networks and exposes organic matter to rapid oxidation. Use no-dig methods wherever possible.
2. **Keep it covered**: Bare soil loses moisture, heats up, and erodes. Maintain permanent cover with mulch or living plants.
3. **Diversify root systems**: Different root architectures (taproots, fibrous roots, tubers) create diverse habitats for soil life at different depths.
4. **Add organic matter**: Compost, leaf mulch, and chop-and-drop prunings feed the soil food web continuously.
5. **Reduce chemical inputs**: Synthetic fertilizers bypass the microbial exchange, leading to dependency and soil degradation over time.`,
    relatedPlants: [
      'Trifolium repens',
      'Symphytum officinale',
      'Raphanus sativus',
      'Vicia faba',
    ],
  },
  {
    id: 'permaculture-design-principles',
    title: 'Permaculture Design Principles',
    topic: 'permaculture',
    content: `# Permaculture Design Principles

Permaculture is a design system for creating sustainable human habitats by following patterns observed in natural ecosystems. Developed by Bill Mollison and David Holmgren in the 1970s, it offers a framework for integrating food production, shelter, energy, and community into resilient whole systems.

## Core Ethics

All permaculture design begins with three ethics: **Earth Care** (regenerate natural systems), **People Care** (meet human needs equitably), and **Fair Share** (limit consumption, redistribute surplus).

## Holmgren's Twelve Principles

1. **Observe and interact**: Spend a full year watching your site before making major changes
2. **Catch and store energy**: Harvest sunlight, rainwater, and biomass at peak availability
3. **Obtain a yield**: Every element must produce something useful
4. **Apply self-regulation and accept feedback**: Design systems that correct themselves
5. **Use and value renewable resources**: Prefer biological solutions over fossil-fuel inputs
6. **Produce no waste**: Every output becomes an input for another element
7. **Design from patterns to details**: Read the landscape at macro scale before planning plant placement
8. **Integrate rather than segregate**: Beneficial relationships emerge when elements are placed to interact
9. **Use small and slow solutions**: Start with what you can manage and observe closely
10. **Use and value diversity**: Polycultures outperform monocultures in resilience and total yield
11. **Use edges and value the marginal**: The boundary between two ecosystems is the most productive zone
12. **Creatively use and respond to change**: Work with succession, not against it

## Applying Principles in Design

Zone planning (placing elements by frequency of use), sector analysis (mapping sun, wind, water, and wildlife flows), and stacking functions (each element serves multiple purposes) are practical tools that translate these principles into spatial design decisions.`,
    relatedPlants: [
      'Alnus glutinosa',
      'Elaeagnus umbellata',
      'Robinia pseudoacacia',
    ],
  },
]
