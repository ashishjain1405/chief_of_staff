export const MERCHANT_DATA: Record<string, { aliases: string[]; domain: string; category: string }> = {
  "Amazon":            { domain: "amazon.in",          category: "ecommerce",            aliases: ["AMAZON","AMAZON IN","AMAZON INDIA","AMAZON SELLER SERVICES","AMZN","AMZN MKTPLACE","AMZN MKTP","AMAZON RETAIL","AMAZON PRIME","WWW AMAZON IN"] },
  "Amazon Pay":        { domain: "amazonpay.in",        category: "payments",             aliases: ["AMAZON PAY","AMAZONPAY","AMZN PAY"] },
  "Flipkart":          { domain: "flipkart.com",        category: "ecommerce",            aliases: ["FLIPKART","FKRT","FKRT INTERNET","FLIPKART INTERNET","FLIPKART INDIA"] },
  "Myntra":            { domain: "myntra.com",          category: "fashion",              aliases: ["MYNTRA","MYNTRA DESIGNS","MYNTRA.COM"] },
  "Ajio":              { domain: "ajio.com",            category: "fashion",              aliases: ["AJIO","AJIO RETAIL","RELIANCE AJIO"] },
  "Nykaa":             { domain: "nykaa.com",           category: "beauty",               aliases: ["NYKAA","NYKAA E RETAIL","NYKAA.COM"] },
  "Tata Cliq":         { domain: "tatacliq.com",        category: "ecommerce",            aliases: ["TATA CLIQ","TATACLIQ","TATA CLiQ"] },
  "Meesho":            { domain: "meesho.com",          category: "ecommerce",            aliases: ["MEESHO","MEESHO SUPPLY"] },
  "Snapdeal":          { domain: "snapdeal.com",        category: "ecommerce",            aliases: ["SNAPDEAL"] },
  "JioMart":           { domain: "jiomart.com",         category: "groceries",            aliases: ["JIOMART","JIO MART"] },
  "BigBasket":         { domain: "bigbasket.com",       category: "groceries",            aliases: ["BIGBASKET","BIG BASKET","SUPERMARKET GROCERY"] },
  "Blinkit":           { domain: "blinkit.com",         category: "groceries",            aliases: ["BLINKIT","GROFERS","GROFERS INDIA","BLINK COMMERCE"] },
  "Zepto":             { domain: "zepto.co.in",         category: "groceries",            aliases: ["ZEPTO","KIRANAKART","ZEPTO NOW"] },
  "DMart":             { domain: "dmart.in",            category: "groceries",            aliases: ["DMART","D MART","AVENUE SUPERMARTS"] },
  "Swiggy":            { domain: "swiggy.in",           category: "food_delivery",        aliases: ["SWIGGY","SWIGGY LIMITED","SWIGGY INSTAMART","SWIGGY ONLINE","BUNDL TECHNOLOGIES","SWIGGY FOOD"] },
  "Zomato":            { domain: "zomato.com",          category: "food_delivery",        aliases: ["ZOMATO","ZOMATO LIMITED","ZOMATO ONLINE","ZOMATO MEDIA"] },
  "EatSure":           { domain: "eatsure.com",         category: "food_delivery",        aliases: ["EATSURE","EAT SURE"] },
  "Domino's":          { domain: "dominos.co.in",       category: "restaurants",          aliases: ["DOMINOS","DOMINO'S","PIZZAONLINE DOMINOS"] },
  "McDelivery":        { domain: "mcdelivery.co.in",    category: "restaurants",          aliases: ["MCDELIVERY","MCDONALDS","MC DONALDS"] },
  "Burger King":       { domain: "burgerking.in",       category: "restaurants",          aliases: ["BURGER KING","BURGERKING"] },
  "KFC":               { domain: "kfc.co.in",           category: "restaurants",          aliases: ["KFC","KFC INDIA"] },
  "Subway":            { domain: "subway.in",           category: "restaurants",          aliases: ["SUBWAY"] },
  "Uber":              { domain: "uber.com",            category: "transport",            aliases: ["UBER","UBER INDIA","UBER BV","UBER TRIP","UBER EATS","UBER *TRIP"] },
  "Ola":               { domain: "olacabs.com",         category: "transport",            aliases: ["OLA","OLA CABS","ANI TECHNOLOGIES","OLA MONEY"] },
  "Rapido":            { domain: "rapido.bike",         category: "transport",            aliases: ["RAPIDO","RAPIDO BIKE","ROPOSO RAPIDO"] },
  "MakeMyTrip":        { domain: "makemytrip.com",      category: "travel",               aliases: ["MAKEMYTRIP","MMT","MMT INDIA","MAKEMYTRIP INDIA"] },
  "Goibibo":           { domain: "goibibo.com",         category: "travel",               aliases: ["GOIBIBO","IBIBO","GO IBIBO"] },
  "Yatra":             { domain: "yatra.com",           category: "travel",               aliases: ["YATRA","YATRA ONLINE"] },
  "Cleartrip":         { domain: "cleartrip.com",       category: "travel",               aliases: ["CLEARTRIP","CLEAR TRIP"] },
  "Ixigo":             { domain: "ixigo.com",           category: "travel",               aliases: ["IXIGO","LE TRAVENUES"] },
  "Airbnb":            { domain: "airbnb.com",          category: "travel",               aliases: ["AIRBNB","AIRBNB PAYMENTS"] },
  "Booking.com":       { domain: "booking.com",         category: "travel",               aliases: ["BOOKING.COM","BOOKING BV","BOOKINGCOM"] },
  "Agoda":             { domain: "agoda.com",           category: "travel",               aliases: ["AGODA"] },
  "EaseMyTrip":        { domain: "easemytrip.com",      category: "travel",               aliases: ["EASEMYTRIP","EASE MY TRIP"] },
  "Expedia":           { domain: "expedia.com",         category: "travel",               aliases: ["EXPEDIA","EXPEDIA BOOKING","EXPEDIA TRAVEL","EXPEDIA INC","EXPEDIA GROUP"] },
  "Hotels.com":        { domain: "hotels.com",          category: "travel",               aliases: ["HOTELS.COM","HOTELSCOM","HOTELS COM"] },
  "Vrbo":              { domain: "vrbo.com",            category: "travel",               aliases: ["VRBO","HOMEAWAY"] },
  "Skyscanner":        { domain: "skyscanner.net",      category: "travel",               aliases: ["SKYSCANNER"] },
  "Uber Eats":         { domain: "ubereats.com",        category: "food_delivery",        aliases: ["UBER EATS","UBEREATS","UBER*EATS"] },
  "Zolo":              { domain: "zolostays.com",       category: "travel",               aliases: ["ZOLO","ZOLOSTAYS"] },
  "OYO":               { domain: "oyorooms.com",        category: "travel",               aliases: ["OYO","OYO ROOMS","ORAVEL"] },
  "Treebo":            { domain: "treebo.com",          category: "travel",               aliases: ["TREEBO","TREEBO HOTELS"] },
  "RedBus":            { domain: "redbus.in",           category: "travel",               aliases: ["REDBUS","RED BUS"] },
  "AbhiBus":           { domain: "abhibus.com",         category: "travel",               aliases: ["ABHIBUS","ABHI BUS"] },
  "IndiGo":            { domain: "indigo.in",           category: "travel",               aliases: ["INDIGO","INTERGLOBE","6E AIRLINES"] },
  "Air India":         { domain: "airindia.com",        category: "travel",               aliases: ["AIR INDIA","AIRINDIA"] },
  "SpiceJet":          { domain: "spicejet.com",        category: "travel",               aliases: ["SPICEJET","SPICE JET"] },
  "Netflix":           { domain: "netflix.com",         category: "subscriptions",        aliases: ["NETFLIX","NETFLIX.COM","NETFLIX INDIA"] },
  "Spotify":           { domain: "spotify.com",         category: "subscriptions",        aliases: ["SPOTIFY","SPOTIFY AB","SPOTIFY INDIA"] },
  "YouTube":           { domain: "youtube.com",         category: "subscriptions",        aliases: ["YOUTUBE","YOUTUBE PREMIUM","GOOGLE YOUTUBE"] },
  "Prime Video":       { domain: "primevideo.com",      category: "subscriptions",        aliases: ["PRIME VIDEO","AMAZON PRIME","AMZN PRIME"] },
  "Disney+ Hotstar":   { domain: "hotstar.com",         category: "subscriptions",        aliases: ["HOTSTAR","DISNEY HOTSTAR","DISNEY+ HOTSTAR"] },
  "JioCinema":         { domain: "jiocinema.com",       category: "subscriptions",        aliases: ["JIOCINEMA","JIO CINEMA"] },
  "Apple":             { domain: "apple.com",           category: "technology",           aliases: ["APPLE","APPLE.COM","APPLE SERVICES","APPLE BILL","APPLE ONLINE"] },
  "Google":            { domain: "google.com",          category: "technology",           aliases: ["GOOGLE","GOOGLE CLOUD","GOOGLE STORAGE","GOOGLE PLAY","GOOGLE ADS","GOOGLE *SERVICES"] },
  "Microsoft":         { domain: "microsoft.com",       category: "technology",           aliases: ["MICROSOFT","MSFT","MICROSOFT 365","AZURE","XBOX"] },
  "OpenAI":            { domain: "openai.com",          category: "ai_tools",             aliases: ["OPENAI","CHATGPT","CHATGPT PLUS"] },
  "Notion":            { domain: "notion.so",           category: "productivity",         aliases: ["NOTION","NOTION LABS"] },
  "Slack":             { domain: "slack.com",           category: "productivity",         aliases: ["SLACK","SLACK TECHNOLOGIES"] },
  "Zoom":              { domain: "zoom.us",             category: "productivity",         aliases: ["ZOOM","ZOOM VIDEO","ZOOM.US"] },
  "Canva":             { domain: "canva.com",           category: "productivity",         aliases: ["CANVA","CANVA PTY"] },
  "Figma":             { domain: "figma.com",           category: "productivity",         aliases: ["FIGMA","FIGMA INC"] },
  "Adobe":             { domain: "adobe.com",           category: "productivity",         aliases: ["ADOBE","ADOBE SYSTEMS","ADOBE CREATIVE CLOUD"] },
  "LinkedIn":          { domain: "linkedin.com",        category: "professional_network", aliases: ["LINKEDIN","LINKEDIN PREMIUM"] },
  "Apollo 247":        { domain: "apollo247.com",       category: "healthcare",           aliases: ["APOLLO","APOLLO247","APOLLO PHARMACY"] },
  "PharmEasy":         { domain: "pharmeasy.in",        category: "healthcare",           aliases: ["PHARMEASY","API HOLDINGS"] },
  "Tata 1mg":          { domain: "1mg.com",             category: "healthcare",           aliases: ["1MG","TATA1MG","TATA 1MG"] },
  "Netmeds":           { domain: "netmeds.com",         category: "healthcare",           aliases: ["NETMEDS","NETMEDS.COM"] },
  "Practo":            { domain: "practo.com",          category: "healthcare",           aliases: ["PRACTO","PRACTO TECHNOLOGIES"] },
  "Cult.fit":          { domain: "cult.fit",            category: "fitness",              aliases: ["CULTFIT","CUREFIT","CULT FIT"] },
  "Urban Company":     { domain: "urbancompany.com",    category: "home_services",        aliases: ["URBAN COMPANY","URBANCLAP","URBAN COMPANY SERVICES"] },
  "Pepperfry":         { domain: "pepperfry.com",       category: "furniture",            aliases: ["PEPPERFRY","PEPPER FRY"] },
  "IKEA":              { domain: "ikea.com",            category: "furniture",            aliases: ["IKEA","IKEA INDIA"] },
  "Lenskart":          { domain: "lenskart.com",        category: "eyewear",              aliases: ["LENSKART","LENSKART SOLUTIONS"] },
  "CaratLane":         { domain: "caratlane.com",       category: "jewelry",              aliases: ["CARATLANE","CARAT LANE"] },
  "Tanishq":           { domain: "tanishq.co.in",       category: "jewelry",              aliases: ["TANISHQ","TITAN TANISHQ"] },
  "Croma":             { domain: "croma.com",           category: "electronics",          aliases: ["CROMA","INFINITI RETAIL"] },
  "Reliance Digital":  { domain: "reliancedigital.in",  category: "electronics",          aliases: ["RELIANCE DIGITAL","RELIANCE RETAIL"] },
  "Vijay Sales":       { domain: "vijaysales.com",      category: "electronics",          aliases: ["VIJAY SALES","VIJAYSALES"] },
  "Boat":              { domain: "boat-lifestyle.com",  category: "electronics",          aliases: ["BOAT","BOAT LIFESTYLE","IMAGINE MARKETING"] },
  "Samsung":           { domain: "samsung.com",         category: "electronics",          aliases: ["SAMSUNG","SAMSUNG INDIA","SAMSUNG ONLINE"] },
  "Xiaomi":            { domain: "mi.com",              category: "electronics",          aliases: ["MI","XIAOMI","MI INDIA"] },
  "OnePlus":           { domain: "oneplus.in",          category: "electronics",          aliases: ["ONEPLUS","ONE PLUS"] },
  "Realme":            { domain: "realme.com",          category: "electronics",          aliases: ["REALME","REALME INDIA"] },
  "Airtel":            { domain: "airtel.in",           category: "telecom",              aliases: ["AIRTEL","BHARTI AIRTEL","AIRTEL POSTPAID","AIRTEL PREPAID"] },
  "Jio":               { domain: "jio.com",             category: "telecom",              aliases: ["JIO","RELIANCE JIO","MYJIO"] },
  "Vi":                { domain: "vi.in",               category: "telecom",              aliases: ["VODAFONE IDEA","VI","VODAFONE","IDEA CELLULAR"] },
  "Tata Play":         { domain: "tataplay.com",        category: "utilities",            aliases: ["TATA PLAY","TATASKY","TATA SKY"] },
  "ACT":               { domain: "actcorp.in",          category: "internet",             aliases: ["ACT","ACT FIBERNET"] },
  "Hathway":           { domain: "hathway.com",         category: "internet",             aliases: ["HATHWAY"] },
  "Dream11":           { domain: "dream11.com",         category: "gaming",               aliases: ["DREAM11","DREAM 11"] },
  "MPL":               { domain: "mpl.live",            category: "gaming",               aliases: ["MPL","MOBILE PREMIER LEAGUE"] },
  "Paytm":             { domain: "paytm.com",           category: "payments",             aliases: ["PAYTM","ONE97","PAYTM WALLET","PAYTM POSTPAID","PAYTM PAYMENTS"] },
  "PhonePe":           { domain: "phonepe.com",         category: "payments",             aliases: ["PHONEPE","PHONE PE","PHONEPE PVT LTD"] },
  "Google Pay":        { domain: "googlepay.in",        category: "payments",             aliases: ["GOOGLE PAY","GPAY","GOOGLEPAY","GOOGLE PAYMENT"] },
  "Mobikwik":          { domain: "mobikwik.com",        category: "payments",             aliases: ["MOBIKWIK","MOBIKWIK SYSTEMS"] },
  "Razorpay":          { domain: "razorpay.com",        category: "payments",             aliases: ["RAZORPAY","RAZOR PAY","RZP"] },
  "Cashfree":          { domain: "cashfree.com",        category: "payments",             aliases: ["CASHFREE","CASHFREE PAYMENTS"] },
  "PayU":              { domain: "payu.in",             category: "payments",             aliases: ["PAYU","PAYU MONEY","PAYU PAYMENTS","PAYUMONEY"] },
  "Zerodha":           { domain: "zerodha.com",         category: "investments",          aliases: ["ZERODHA","ZERODHA BROKING","COIN ZERODHA"] },
  "Groww":             { domain: "groww.in",            category: "investments",          aliases: ["GROWW","NEXTBILLION TECHNOLOGY"] },
  "Upstox":            { domain: "upstox.com",          category: "investments",          aliases: ["UPSTOX","RKSV","UPSTOX SECURITIES"] },
  "Angel One":         { domain: "angelone.in",         category: "investments",          aliases: ["ANGELONE","ANGEL BROKING","ANGEL ONE"] },
  "PolicyBazaar":      { domain: "policybazaar.com",    category: "insurance",            aliases: ["POLICYBAZAAR","PB FINTECH"] },
  "Acko":              { domain: "acko.com",            category: "insurance",            aliases: ["ACKO","ACKO GENERAL INSURANCE"] },
};

const ALIAS_LOOKUP: Record<string, string> = {};
for (const [canonical, data] of Object.entries(MERCHANT_DATA)) {
  for (const alias of data.aliases) ALIAS_LOOKUP[alias.toUpperCase()] = canonical;
}

const DOMAIN_LOOKUP: Record<string, string> = {};
for (const [canonical, data] of Object.entries(MERCHANT_DATA)) {
  DOMAIN_LOOKUP[data.domain] = canonical;
}

export function normalizeMerchant(raw: string): string {
  const upper = raw.toUpperCase().trim();
  if (ALIAS_LOOKUP[upper]) return ALIAS_LOOKUP[upper];
  for (const alias of Object.keys(ALIAS_LOOKUP)) {
    if (upper.startsWith(alias)) return ALIAS_LOOKUP[alias];
  }
  return raw.trim().replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

export function getCategoryForMerchant(normalized: string): string | null {
  return MERCHANT_DATA[normalized]?.category ?? null;
}

export function getMerchantFromDomain(domain: string): string | null {
  return DOMAIN_LOOKUP[domain] ?? null;
}
