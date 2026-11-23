// Study configuration. The publishable key is safe to expose: browsers can only call the
// gp_start_session / gp_log_events / gp_finish_session functions; tables are not readable.
window.GP_CONFIG = {
  SUPABASE_URL: "https://squalnvpfpzvaodxkxcf.supabase.co",
  SUPABASE_KEY: "sb_publishable_VhCxKCsd8ZZARqe6eWpWnQ_LtQTsQPc",

  // Linguistic stimuli: all three are 52 characters long, so every slogan occupies the
  // same single-line text region on screen.
  SENTENCES: {
    GP: "The cotton clothing is made of grows in Mississippi.",
    CA: "Clothing crafted from soft Mississippi-grown cotton.",
    CB: "Classic clothing from cotton sourced in Mississippi."
  },

  // One photograph recolored in CIELAB: identical lightness (L* = 53) and chroma (C* = 46.5);
  // only hue differs (30°, 287°, 142°). Hex values are the mean shirt color. See assets/colors.json.
  COLORS: {
    red:   { hex: "#C66059", label: "Red",   img: "assets/shirt_red.jpg" },
    blue:  { hex: "#627BCB", label: "Blue",  img: "assets/shirt_blue.jpg" },
    green: { hex: "#478D4B", label: "Green", img: "assets/shirt_green.jpg" }
  },

  MIN_VIEW_MS: 1000,   // an ad counts as "seen" after 1 s on its page
  FLUSH_MS: 5000       // event upload interval
};
