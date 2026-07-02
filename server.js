const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Vos clés d'accès à mettre à jour avec votre clé 'anon / public' (commençant par eyJ)
const supabaseUrl = "https://h5yysrs0ozflzfm.supabase.co"; 
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpmZ2ZxY3RpZGZ0cnhpYnBsbnBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3NDEzNzUsImV4cCI6MjA5ODMxNzM3NX0.HvllcYGZZx3H_yDa44qkVpEIYk_-_c7sHSb6i9yrApc"; 
const supabase = createClient(supabaseUrl, supabaseKey);

const ADMIN_KEY = process.env.ADMIN_KEY || "admin123";

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function checkAdminToken(req, res, next) {
    const token = req.headers['x-admin-token'];
    if (!token || token !== ADMIN_KEY) {
        return res.status(403).json({ error: "Accès refusé : Clé d'administration invalide." });
    }
    next();
}

app.get('/api/states', async (req, res) => {
    try {
        const { data, error } = await supabase.from('app_state').select('*');
        if (error) return res.status(500).json({ error: error.message });
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: "Erreur serveur" });
    }
});

// Initialisation par l'ADMIN (Verrouillage initial)
app.post('/api/init/:name', checkAdminToken, async (req, res) => {
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

// Tirage au sort par le MANAGER ou l'ADMIN
app.post('/api/draw/:name', async (req, res) => {
    const { data: current, error: fetchErr } = await supabase.from('app_state').select('*').eq('name', req.params.name).single();
    if (fetchErr) return res.status(500).json({ error: fetchErr.message });

    if (!current.remaining_list || current.remaining_list.length === 0) {
        return res.status(400).json({ error: "Tous les participants ont déjà été piochés." });
    }

    let remaining = [...current.remaining_list];
    let drawn = [...current.drawn_people || []];
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

// REMISE À ZÉRO INTELLIGENTE : Relance et reverrouille automatiquement la même liste
app.post('/api/reset/:name', async (req, res) => {
    const token = req.headers['x-admin-token'];
    const { data: current, error: fetchErr } = await supabase.from('app_state').select('*').eq('name', req.params.name).single();
    
    if (fetchErr) return res.status(500).json({ error: fetchErr.message });

    const isUrlAdmin = (token && token === ADMIN_KEY);
    const isListEmpty = (current && current.initial_list && current.initial_list.length > 0 && current.remaining_list.length === 0);

    // Sécurité : Seul l'admin peut reset en cours de route. Le manager doit attendre qu'elle soit vide.
    if (!isUrlAdmin && !isListEmpty) {
        return res.status(403).json({ error: "Action refusée : La liste n'est pas encore terminée." });
    }

    // Si pas de liste de départ, on ne peut rien faire
    if (!current.initial_list || current.initial_list.length === 0) {
        return res.status(400).json({ error: "Aucune liste de base à reverrouiller." });
    }

    // LE CHANGEMENT EST ICI : On reprend la liste initiale, on la remélange et on RE-VERROUILLE direct !
    const { error } = await supabase.from('app_state').update({
        remaining_list: shuffle([...current.initial_list]), // On remélange la même liste
        drawn_people: [],                                   // On vide les sélectionnés
        current_selection: null                             // On remet le bandeau à zéro
    }).eq('name', req.params.name);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

app.listen(PORT, () => {
    console.log(`Serveur actif sur le port ${PORT}`);
});
