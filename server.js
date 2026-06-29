const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-client');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Mot de passe administrateur ("admin123" par défaut si non configuré sur Render)
const ADMIN_KEY = process.env.ADMIN_KEY || "admin123";

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// Sécurité : Vérifie la présence et la validité du token admin
function checkAdminToken(req, res, next) {
    const token = req.headers['x-admin-token'];
    if (!token || token !== ADMIN_KEY) {
        return res.status(403).json({ error: "Accès refusé : Clé d'administration invalide." });
    }
    next();
}

// Récupérer l'état complet des 4 listes
app.get('/api/states', async (req, res) => {
    try {
        const { data, error } = await supabase.from('app_state').select('*');
        if (error) return res.status(500).json({ error: error.message });
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: "Erreur serveur" });
    }
});

// Verrouiller/Initialiser une liste (Réservé à l'admin)
app.post('/api/init/:name', checkAdminToken, async (req, res) => {
    const { data: current } = await supabase.from('app_state').select('*').eq('name', req.params.name).single();
    if (current.initial_list.length > 0 && current.remaining_list.length > 0) {
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

// Tirer une personne au sort (Accessible aux managers)
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

// Remettre à zéro une liste (Réservé à l'admin)
app.post('/api/reset/:name', checkAdminToken, async (req, res) => {
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