const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configuration des clés de connexion Supabase
const supabaseUrl = "https://h5yysrs0ozflzfm.supabase.co"; 
const supabaseKey = "sb_publishable_H5YYSrS0ozFLZFMigudS3w_LINF6SkC";
const supabase = createClient(supabaseUrl, supabaseKey);

// Mot de passe administrateur ("admin123" par défaut si non configuré sur Render)
const ADMIN_KEY = process.env.ADMIN_KEY || "admin123";

// Fonction utilitaire pour mélanger aléatoirement les conducteurs
function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// Sécurité : Vérifie la présence et la validité du token admin pour la configuration initiale
function checkAdminToken(req, res, next) {
    const token = req.headers['x-admin-token'];
    if (!token || token !== ADMIN_KEY) {
        return res.status(403).json({ error: "Accès refusé : Clé d'administration invalide." });
    }
    next();
}

// 1. Récupérer l'état complet des 4 listes de missions
app.get('/api/states', async (req, res) => {
    try {
        const { data, error } = await supabase.from('app_state').select('*');
        if (error) return res.status(500).json({ error: error.message });
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: "Erreur serveur lors de la récupération" });
    }
});

// 2. Verrouiller et initialiser une liste (Réservé strictement à l'admin)
app.post('/api/init/:name', checkAdminToken, async (req, res) => {
    const { data: current } = await supabase.from('app_state').select('*').eq('name', req.params.name).single();
    if (current && current.initial_list.length > 0 && current.remaining_list.length > 0) {
        return res.status(403).json({ error: "La liste est déjà en cours et non terminée !" });
    }

    const { names } = req.body;
    if (!names || !Array.isArray(names) || names.length === 0) {
        return res.status(400).json({ error: "La liste est vide." });
    }

    const cleanNames = names.map(n => n.trim()).filter(n => n !== "");
    const { error } = await supabase.from('app_state').update({
        initial_list: cleanNames,
        remaining_list: shuffle([...cleanNames]),
        drawn_people: [],
        current_selection: null
    }).eq('name', req.params.name);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

// 3. Tirer une personne au sort (Accessible aux managers)
app.post('/api/draw/:name', async (req, res) => {
    const { data: current, error: fetchErr } = await supabase.from('app_state').select('*').eq('name', req.params.name).single();
    if (fetchErr) return res.status(500).json({ error: fetchErr.message });

    if (current.remaining_list.length === 0) {
        return res.status(400).json({ error: "Tous les participants ont déjà été piochés." });
    }

    let remaining = [...current.remaining_list];
    let drawn = [...current.drawn_people];
    const selected = remaining.shift();
    drawn.push(selected);

    const { error: updateErr } = await supabase.from('app_state').update({
        remaining_list: remaining,
        drawn_people: drawn,
        current_selection: selected
    }).eq('name', req.params.name);

    if (updateErr) return res.status(500).json({ error: updateErr.message });
    res.json({ success: true });
});

// 4. Remettre à zéro une liste (Autorisé si Admin OU si la liste est complètement vide/épuisée)
app.post('/api/reset/:name', async (req, res) => {
    const token = req.headers['x-admin-token'];
    
    // Récupérer l'état actuel de la liste concernée
    const { data: current } = await supabase.from('app_state').select('*').eq('name', req.params.name).single();
    
    const isUrlAdmin = (token && token === ADMIN_KEY);
    const isListEmpty = (current && current.initial_list.length > 0 && current.remaining_list.length === 0);

    // Si l'utilisateur n'est pas Admin ET que la liste n'est pas encore finie -> Accès Refusé
    if (!isUrlAdmin && !isListEmpty) {
        return res.status(403).json({ error: "Action refusée : Seul l'administrateur peut réinitialiser une liste en cours de tirage." });
    }

    // Si les conditions sont respectées, on nettoie les données dans Supabase
    const { error } = await supabase.from('app_state').update({
        initial_list: [],
        remaining_list: [],
        drawn_people: [],
        current_selection: null
    }).eq('name', req.params.name);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

app.listen(PORT, () => {
    console.log(`Serveur sécurisé actif sur le port ${PORT}`);
});
