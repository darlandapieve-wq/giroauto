--
-- PostgreSQL database dump
--


-- Dumped from database version 17.11
-- Dumped by pg_dump version 17.11

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: repasse; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA repasse;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: anuncios; Type: TABLE; Schema: repasse; Owner: -
--

CREATE TABLE repasse.anuncios (
    id uuid NOT NULL,
    codigo text,
    status text NOT NULL,
    criado_em timestamp with time zone DEFAULT now(),
    grupo_jid text,
    grupo_nome text,
    remetente_id text,
    remetente_nome text,
    marca text,
    modelo text,
    categoria text,
    ano_modelo integer,
    km integer,
    preco_original integer,
    preco_repasse integer,
    fipe integer,
    dados jsonb NOT NULL,
    texto text,
    motivos jsonb DEFAULT '[]'::jsonb,
    fp1 text,
    fp2 text,
    vezes_recebido integer DEFAULT 1,
    ultimo_recebido timestamp with time zone DEFAULT now(),
    repetir boolean DEFAULT false,
    repetir_horas numeric,
    vezes_enviado integer DEFAULT 0,
    ultimo_envio timestamp with time zone,
    proximo_envio timestamp with time zone,
    encerrado_em timestamp with time zone,
    nota text,
    reducao_ativa boolean DEFAULT false,
    reducao_passo integer,
    reducao_piso integer,
    texto_editado boolean DEFAULT false,
    vendido_em timestamp with time zone,
    numero_fila integer,
    comprador_id integer,
    venda_valor integer,
    venda_data date,
    venda_pagamento text,
    venda_obs text,
    conta_id integer NOT NULL,
    info_extra text
);


--
-- Name: compradores; Type: TABLE; Schema: repasse; Owner: -
--

CREATE TABLE repasse.compradores (
    id integer NOT NULL,
    nome text NOT NULL,
    telefone text,
    documento text,
    cidade text,
    uf text,
    tipo text DEFAULT 'lojista'::text,
    email text,
    obs text,
    criado_em timestamp with time zone DEFAULT now(),
    atualizado_em timestamp with time zone DEFAULT now(),
    conta_id integer NOT NULL
);


--
-- Name: compradores_id_seq; Type: SEQUENCE; Schema: repasse; Owner: -
--

CREATE SEQUENCE repasse.compradores_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: compradores_id_seq; Type: SEQUENCE OWNED BY; Schema: repasse; Owner: -
--

ALTER SEQUENCE repasse.compradores_id_seq OWNED BY repasse.compradores.id;


--
-- Name: contas; Type: TABLE; Schema: repasse; Owner: -
--

CREATE TABLE repasse.contas (
    id integer NOT NULL,
    nome text NOT NULL,
    slug text,
    ativo boolean DEFAULT true,
    responsavel text,
    email text,
    telefone text,
    cidade text,
    obs text,
    seq_codigo integer DEFAULT 0,
    seq_fila integer DEFAULT 0,
    criado_em timestamp with time zone DEFAULT now(),
    ultimo_acesso timestamp with time zone
);


--
-- Name: contas_id_seq; Type: SEQUENCE; Schema: repasse; Owner: -
--

CREATE SEQUENCE repasse.contas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contas_id_seq; Type: SEQUENCE OWNED BY; Schema: repasse; Owner: -
--

ALTER SEQUENCE repasse.contas_id_seq OWNED BY repasse.contas.id;


--
-- Name: contatos; Type: TABLE; Schema: repasse; Owner: -
--

CREATE TABLE repasse.contatos (
    id text NOT NULL,
    nome text,
    status text DEFAULT 'normal'::text,
    anuncios integer DEFAULT 0,
    grupos jsonb DEFAULT '[]'::jsonb,
    ultimo_anuncio timestamp with time zone,
    conta_id integer NOT NULL
);


--
-- Name: conversa_msgs; Type: TABLE; Schema: repasse; Owner: -
--

CREATE TABLE repasse.conversa_msgs (
    id bigint NOT NULL,
    conversa_id text NOT NULL,
    papel text NOT NULL,
    texto text,
    meta jsonb DEFAULT '{}'::jsonb,
    ts timestamp with time zone DEFAULT now()
);


--
-- Name: conversa_msgs_id_seq; Type: SEQUENCE; Schema: repasse; Owner: -
--

CREATE SEQUENCE repasse.conversa_msgs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: conversa_msgs_id_seq; Type: SEQUENCE OWNED BY; Schema: repasse; Owner: -
--

ALTER SEQUENCE repasse.conversa_msgs_id_seq OWNED BY repasse.conversa_msgs.id;


--
-- Name: conversas; Type: TABLE; Schema: repasse; Owner: -
--

CREATE TABLE repasse.conversas (
    id text NOT NULL,
    conta_id integer NOT NULL,
    canal text DEFAULT 'site'::text NOT NULL,
    contato text,
    nome text,
    telefone text,
    anuncio_id uuid,
    lead_id integer,
    dados jsonb DEFAULT '{}'::jsonb,
    pausado_ate timestamp with time zone,
    precisa_humano boolean DEFAULT false,
    ip text,
    criado_em timestamp with time zone DEFAULT now(),
    atualizado_em timestamp with time zone DEFAULT now()
);


--
-- Name: envios; Type: TABLE; Schema: repasse; Owner: -
--

CREATE TABLE repasse.envios (
    id bigint NOT NULL,
    anuncio_id uuid,
    grupo_jid text,
    grupo_nome text,
    ts timestamp with time zone DEFAULT now(),
    ok boolean,
    erro text,
    preco integer,
    rodada integer,
    conta_id integer NOT NULL
);


--
-- Name: envios_id_seq; Type: SEQUENCE; Schema: repasse; Owner: -
--

CREATE SEQUENCE repasse.envios_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: envios_id_seq; Type: SEQUENCE OWNED BY; Schema: repasse; Owner: -
--

ALTER SEQUENCE repasse.envios_id_seq OWNED BY repasse.envios.id;


--
-- Name: fotos; Type: TABLE; Schema: repasse; Owner: -
--

CREATE TABLE repasse.fotos (
    id uuid NOT NULL,
    anuncio_id uuid,
    ordem integer DEFAULT 0,
    capa boolean DEFAULT false,
    largura integer,
    altura integer,
    bytes integer,
    dados bytea NOT NULL,
    criado_em timestamp with time zone DEFAULT now(),
    placa_status text,
    placa_caixas jsonb,
    dados_publico bytea
);


--
-- Name: grupos; Type: TABLE; Schema: repasse; Owner: -
--

CREATE TABLE repasse.grupos (
    jid text NOT NULL,
    nome text,
    fonte boolean DEFAULT false,
    destino boolean DEFAULT false,
    somente_confiaveis boolean DEFAULT false,
    sou_admin boolean DEFAULT false,
    participantes integer DEFAULT 0,
    comunidade text,
    comunidade_nome text,
    somente_admins boolean DEFAULT false,
    regras jsonb DEFAULT '{}'::jsonb,
    mensagens integer DEFAULT 0,
    anuncios integer DEFAULT 0,
    ultimo_anuncio timestamp with time zone,
    criado_em timestamp with time zone DEFAULT now(),
    arquivado boolean DEFAULT true,
    tipo text DEFAULT 'grupo'::text,
    conta_id integer NOT NULL
);


--
-- Name: kv; Type: TABLE; Schema: repasse; Owner: -
--

CREATE TABLE repasse.kv (
    chave text NOT NULL,
    valor jsonb NOT NULL,
    atualizado timestamp with time zone DEFAULT now()
);


--
-- Name: leads; Type: TABLE; Schema: repasse; Owner: -
--

CREATE TABLE repasse.leads (
    id integer NOT NULL,
    nome text,
    telefone text,
    mensagem text,
    anuncio_id uuid,
    codigo text,
    origem text DEFAULT 'vitrine'::text,
    status text DEFAULT 'novo'::text,
    obs text,
    criado_em timestamp with time zone DEFAULT now(),
    atualizado_em timestamp with time zone DEFAULT now(),
    conta_id integer NOT NULL,
    conversa_id text
);


--
-- Name: leads_id_seq; Type: SEQUENCE; Schema: repasse; Owner: -
--

CREATE SEQUENCE repasse.leads_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: leads_id_seq; Type: SEQUENCE OWNED BY; Schema: repasse; Owner: -
--

ALTER SEQUENCE repasse.leads_id_seq OWNED BY repasse.leads.id;


--
-- Name: mensagens; Type: TABLE; Schema: repasse; Owner: -
--

CREATE TABLE repasse.mensagens (
    id text NOT NULL,
    chat_jid text NOT NULL,
    ts timestamp with time zone NOT NULL,
    remetente_id text,
    remetente_nome text,
    texto text,
    tem_imagem boolean DEFAULT false,
    bruto text,
    processado boolean DEFAULT false,
    conta_id integer NOT NULL
);


--
-- Name: seq_codigo; Type: SEQUENCE; Schema: repasse; Owner: -
--

CREATE SEQUENCE repasse.seq_codigo
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_fila; Type: SEQUENCE; Schema: repasse; Owner: -
--

CREATE SEQUENCE repasse.seq_fila
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: usuarios; Type: TABLE; Schema: repasse; Owner: -
--

CREATE TABLE repasse.usuarios (
    id integer NOT NULL,
    conta_id integer NOT NULL,
    nome text,
    email text NOT NULL,
    senha_hash text NOT NULL,
    ativo boolean DEFAULT true,
    trocar_senha boolean DEFAULT true,
    criado_em timestamp with time zone DEFAULT now(),
    ultimo_acesso timestamp with time zone
);


--
-- Name: usuarios_id_seq; Type: SEQUENCE; Schema: repasse; Owner: -
--

CREATE SEQUENCE repasse.usuarios_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: usuarios_id_seq; Type: SEQUENCE OWNED BY; Schema: repasse; Owner: -
--

ALTER SEQUENCE repasse.usuarios_id_seq OWNED BY repasse.usuarios.id;


--
-- Name: wa_auth; Type: TABLE; Schema: repasse; Owner: -
--

CREATE TABLE repasse.wa_auth (
    id text NOT NULL,
    valor text NOT NULL
);


--
-- Name: compradores id; Type: DEFAULT; Schema: repasse; Owner: -
--

ALTER TABLE ONLY repasse.compradores ALTER COLUMN id SET DEFAULT nextval('repasse.compradores_id_seq'::regclass);


--
-- Name: contas id; Type: DEFAULT; Schema: repasse; Owner: -
--

ALTER TABLE ONLY repasse.contas ALTER COLUMN id SET DEFAULT nextval('repasse.contas_id_seq'::regclass);


--
-- Name: conversa_msgs id; Type: DEFAULT; Schema: repasse; Owner: -
--

ALTER TABLE ONLY repasse.conversa_msgs ALTER COLUMN id SET DEFAULT nextval('repasse.conversa_msgs_id_seq'::regclass);


--
-- Name: envios id; Type: DEFAULT; Schema: repasse; Owner: -
--

ALTER TABLE ONLY repasse.envios ALTER COLUMN id SET DEFAULT nextval('repasse.envios_id_seq'::regclass);


--
-- Name: leads id; Type: DEFAULT; Schema: repasse; Owner: -
--

ALTER TABLE ONLY repasse.leads ALTER COLUMN id SET DEFAULT nextval('repasse.leads_id_seq'::regclass);


--
-- Name: usuarios id; Type: DEFAULT; Schema: repasse; Owner: -
--

ALTER TABLE ONLY repasse.usuarios ALTER COLUMN id SET DEFAULT nextval('repasse.usuarios_id_seq'::regclass);


--
-- PostgreSQL database dump complete
--


